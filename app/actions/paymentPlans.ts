'use server'

import { revalidatePath } from 'next/cache'
import { getSessionInfo } from '@/lib/supabase/server'
import { getSquareOrderPaidStatus } from '@/lib/square'
import { createStripeCheckoutSession, getStripeSessionPaidStatus } from '@/lib/stripe'
import { computeInstallmentAmounts, computeDueDates, type PlanFrequency } from '@/lib/paymentPlans'

type GenerateLinkState = { success: boolean; message: string; url?: string } | null
type CheckStatusState = { success: boolean; message: string; paid?: boolean } | null
type MarkPaidState = { success: boolean; message: string } | null
type PlanState = { success: boolean; message: string } | null

// Shared by every path that can pay off an installment (the Stripe/Square
// webhooks aside, which each keep their own copy - see
// app/api/webhooks/stripe/route.ts and app/api/webhooks/square/route.ts) -
// once none remain unpaid, the plan is done and the invoice itself should
// read Paid just like any other invoice, no separate "plan completed"
// status for the admin to check.
async function maybeCompletePlan(
  supabase: Awaited<ReturnType<typeof getSessionInfo>>['supabase'],
  planId: string,
  invoiceId: string,
  paidVia: 'stripe' | 'square' | 'manual'
) {
  const { data: remaining } = await supabase.from('invoice_installments').select('id').eq('plan_id', planId).is('paid_at', null)
  if (remaining && remaining.length === 0) {
    await supabase.from('invoice_payment_plans').update({ status: 'Completed' }).eq('id', planId)
    await supabase.from('invoices').update({ paid_at: new Date().toISOString(), paid_via: paidVia }).eq('id', invoiceId).is('paid_at', null)
  }
}

// Payment plans are opt-in per customer (see the "Allow payment plans"
// checkbox on Edit Customer) - trusted/regular customers only, at the
// admin's discretion, never offered blanket on every invoice. One plan per
// invoice; each installment gets the same on-demand Stripe Checkout Session
// treatment as a regular invoice (see generatePaymentLink in
// app/actions/paymentLinks.ts).
export async function startPaymentPlan(_prevState: PlanState, formData: FormData): Promise<PlanState> {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const invoiceId = (formData.get('invoice_id') as string) || ''
  const installmentCount = Number(formData.get('installment_count')) || 0
  const frequency = (formData.get('frequency') as string) || 'weekly'
  if (!invoiceId) return { success: false, message: 'Missing invoice id.' }
  if (installmentCount < 2 || installmentCount > 12) return { success: false, message: 'Pick between 2 and 12 installments.' }
  if (!['weekly', 'biweekly', 'monthly'].includes(frequency)) return { success: false, message: 'Invalid frequency.' }

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, amount, paid_at, customer_id, customers(payment_plans_enabled)')
    .eq('id', invoiceId)
    .maybeSingle()
  if (!invoice) return { success: false, message: 'Invoice not found.' }
  if (invoice.paid_at) return { success: false, message: 'This invoice is already paid.' }
  const customer = invoice.customers as unknown as { payment_plans_enabled: boolean } | null
  if (!customer?.payment_plans_enabled) {
    return { success: false, message: "Payment plans aren't enabled for this customer yet - turn it on via Edit Customer first." }
  }

  const { data: existingPlan } = await supabase.from('invoice_payment_plans').select('id').eq('invoice_id', invoiceId).maybeSingle()
  if (existingPlan) return { success: false, message: 'A payment plan already exists for this invoice.' }

  const total = Number(invoice.amount) || 0
  if (total <= 0) return { success: false, message: 'This invoice has no positive total to split.' }
  const amounts = computeInstallmentAmounts(total, installmentCount)
  const dueDates = computeDueDates(new Date(), installmentCount, frequency as PlanFrequency)

  const { data: plan, error: planError } = await supabase
    .from('invoice_payment_plans')
    .insert({ invoice_id: invoiceId, installment_count: installmentCount, frequency })
    .select('id')
    .single()
  if (planError || !plan) return { success: false, message: planError?.message || 'Could not create payment plan.' }

  const { error: installError } = await supabase.from('invoice_installments').insert(
    amounts.map((amount, i) => ({
      plan_id: plan.id,
      invoice_id: invoiceId,
      sequence: i + 1,
      amount,
      due_date: dueDates[i],
    }))
  )
  if (installError) {
    await supabase.from('invoice_payment_plans').delete().eq('id', plan.id)
    return { success: false, message: installError.message }
  }

  revalidatePath('/invoices')
  return { success: true, message: `Payment plan created - ${installmentCount} installments.` }
}

// Alternative to startPaymentPlan above for when the customer, not Jesse,
// should pick the installment count/frequency - they're the ones who have
// to make the schedule fit their own cash flow. Just flips a flag; the
// actual plan gets created by the customer themselves via
// app/api/payment-plan/create once they've made their choice in their
// portal (see PaymentPlanCard.tsx).
export async function offerPaymentPlan(_prevState: PlanState, formData: FormData): Promise<PlanState> {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const invoiceId = (formData.get('invoice_id') as string) || ''
  if (!invoiceId) return { success: false, message: 'Missing invoice id.' }

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, paid_at, customers(payment_plans_enabled)')
    .eq('id', invoiceId)
    .maybeSingle()
  if (!invoice) return { success: false, message: 'Invoice not found.' }
  if (invoice.paid_at) return { success: false, message: 'This invoice is already paid.' }
  const customer = invoice.customers as unknown as { payment_plans_enabled: boolean } | null
  if (!customer?.payment_plans_enabled) {
    return { success: false, message: "Payment plans aren't enabled for this customer yet - turn it on via Edit Customer first." }
  }

  await supabase.from('invoices').update({ payment_plan_offered: true }).eq('id', invoiceId)
  revalidatePath('/invoices')
  return { success: true, message: 'Payment plan offered - the customer can now choose their own schedule in their portal.' }
}

// Identical shape to generatePaymentLink (app/actions/paymentLinks.ts), just
// scoped to one installment's amount instead of the invoice's full total -
// reuses the same InvoicePaymentActions component (its hidden field is
// always named "invoice_id" regardless of what id it actually carries, same
// convention already established for rentals). Checks for an existing
// Square link first (never generates a second, different link for the same
// installment) purely to honor a link already sent before the Stripe
// cutover - new links are always Stripe going forward.
export async function generateInstallmentPaymentLink(_prevState: GenerateLinkState, formData: FormData): Promise<GenerateLinkState> {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const installmentId = (formData.get('invoice_id') as string) || ''
  if (!installmentId) return { success: false, message: 'Missing installment id.' }

  const { data: inst } = await supabase
    .from('invoice_installments')
    .select('id, amount, sequence, invoice_id, square_payment_link_url, stripe_payment_link_url, invoices(invoice_number, customer_email, customer_id)')
    .eq('id', installmentId)
    .maybeSingle()
  if (!inst) return { success: false, message: 'Installment not found.' }
  if (inst.square_payment_link_url) {
    return { success: true, message: 'Payment link already exists.', url: inst.square_payment_link_url }
  }
  if (inst.stripe_payment_link_url) {
    return { success: true, message: 'Payment link already exists.', url: inst.stripe_payment_link_url }
  }

  const invoice = inst.invoices as unknown as { invoice_number: string | null; customer_email: string | null; customer_id: string | null } | null
  const amountCents = Math.round((Number(inst.amount) || 0) * 100)
  if (amountCents <= 0) return { success: false, message: 'Nothing due for this installment.' }

  let buyerEmail = invoice?.customer_email || null
  if (!buyerEmail && invoice?.customer_id) {
    const { data: customer } = await supabase.from('customers').select('email').eq('id', invoice.customer_id).maybeSingle()
    buyerEmail = customer?.email ?? null
  }

  const invoiceNumber = invoice?.invoice_number || inst.invoice_id.slice(0, 8)
  const result = await createStripeCheckoutSession({
    invoiceNumber: `${invoiceNumber}-${inst.sequence}`,
    amountCents,
    buyerEmail,
    redirectUrl: 'https://app.savagechainsaws.com/invoices',
  })
  if (!result.ok) return { success: false, message: result.error }

  await supabase
    .from('invoice_installments')
    .update({ stripe_checkout_session_id: result.sessionId, stripe_payment_link_url: result.url })
    .eq('id', installmentId)
  revalidatePath('/invoices')

  return { success: true, message: 'Payment link generated.', url: result.url }
}

// Checks whichever processor this installment's link was actually created
// through - Stripe for anything generated after the cutover, Square only
// for a link that was already outstanding before it.
export async function checkInstallmentPaymentStatus(_prevState: CheckStatusState, formData: FormData): Promise<CheckStatusState> {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const installmentId = (formData.get('invoice_id') as string) || ''
  if (!installmentId) return { success: false, message: 'Missing installment id.' }

  const { data: inst } = await supabase
    .from('invoice_installments')
    .select('id, square_order_id, stripe_checkout_session_id, paid_at, plan_id, invoice_id')
    .eq('id', installmentId)
    .maybeSingle()
  if (!inst) return { success: false, message: 'Installment not found.' }
  if (inst.paid_at) return { success: true, message: 'Already marked paid.', paid: true }
  if (!inst.stripe_checkout_session_id && !inst.square_order_id) {
    return { success: false, message: 'No payment link generated yet.' }
  }

  const result = inst.stripe_checkout_session_id
    ? await getStripeSessionPaidStatus(inst.stripe_checkout_session_id)
    : await getSquareOrderPaidStatus(inst.square_order_id as string)
  if (!result.ok) return { success: false, message: result.error }

  if (result.paid) {
    const paidVia = inst.stripe_checkout_session_id ? 'stripe' : 'square'
    await supabase.from('invoice_installments').update({ paid_at: new Date().toISOString(), paid_via: paidVia }).eq('id', installmentId)
    await maybeCompletePlan(supabase, inst.plan_id, inst.invoice_id, paidVia)
    revalidatePath('/invoices')
    return { success: true, message: 'Payment confirmed - marked Paid.', paid: true }
  }
  return { success: true, message: 'Not paid yet.', paid: false }
}

export async function toggleInstallmentManualPaid(_prevState: MarkPaidState, formData: FormData): Promise<MarkPaidState> {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const installmentId = (formData.get('invoice_id') as string) || ''
  const nextPaid = formData.get('next_paid') === 'true'
  if (!installmentId) return { success: false, message: 'Missing installment id.' }

  const { data: inst } = await supabase.from('invoice_installments').select('plan_id, invoice_id').eq('id', installmentId).maybeSingle()
  const { error } = await supabase
    .from('invoice_installments')
    .update(nextPaid ? { paid_at: new Date().toISOString(), paid_via: 'manual' } : { paid_at: null, paid_via: null })
    .eq('id', installmentId)
  if (error) return { success: false, message: `Could not update: ${error.message}` }

  if (inst) {
    if (nextPaid) {
      await maybeCompletePlan(supabase, inst.plan_id, inst.invoice_id, 'manual')
    } else {
      // Un-marking an installment reopens the plan/invoice if that
      // installment being paid is what had just completed them.
      await supabase.from('invoice_payment_plans').update({ status: 'Active' }).eq('id', inst.plan_id)
      await supabase.from('invoices').update({ paid_at: null, paid_via: null }).eq('id', inst.invoice_id)
    }
  }

  revalidatePath('/invoices')
  return { success: true, message: nextPaid ? 'Marked paid.' : 'Marked unpaid.' }
}

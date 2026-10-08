import { Fragment } from 'react'
import { revalidatePath } from 'next/cache'
import { getSessionInfo } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSquareOrderPaidStatus } from '@/lib/square'
import { createStripeCheckoutSession, getStripeSessionPaidStatus } from '@/lib/stripe'
import { getDefaultTaxRatePercent } from '@/lib/billing'
import { computeInstallmentAmounts, computeDueDates, type PlanFrequency } from '@/lib/paymentPlans'
import { unitLabel } from '@/lib/units'
import SendInvoiceButton from '../components/SendInvoiceButton'
import DeleteInvoiceButton from '../components/DeleteInvoiceButton'
import InvoicePaymentActions from '../components/InvoicePaymentActions'
import MarkPaidToggle from '../components/MarkPaidToggle'
import ArchiveToggle from '../components/ArchiveToggle'
import CreateInvoiceButton from '../components/CreateInvoiceButton'
import EditInvoiceButton from '../components/EditInvoiceButton'
import PaymentPlanSection from '../components/PaymentPlanSection'
import { toggleManualPaid, toggleArchived, deleteInvoice } from '../actions/invoiceLifecycle'
import { sendInvoiceEmail } from '../actions/sendInvoiceEmail'

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
// treatment as a regular invoice (see generatePaymentLink below).
async function startPaymentPlan(_prevState: PlanState, formData: FormData): Promise<PlanState> {
  'use server'
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
async function offerPaymentPlan(_prevState: PlanState, formData: FormData): Promise<PlanState> {
  'use server'
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

// Identical shape to generatePaymentLink below, just scoped to one
// installment's amount instead of the invoice's full total - reuses the
// same InvoicePaymentActions component (its hidden field is always named
// "invoice_id" regardless of what id it actually carries, same convention
// already established for rentals). Checks for an existing Square link
// first (never generates a second, different link for the same
// installment) purely to honor a link already sent before the Stripe
// cutover - new links are always Stripe going forward.
async function generateInstallmentPaymentLink(_prevState: GenerateLinkState, formData: FormData): Promise<GenerateLinkState> {
  'use server'
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
async function checkInstallmentPaymentStatus(_prevState: CheckStatusState, formData: FormData): Promise<CheckStatusState> {
  'use server'
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

async function toggleInstallmentManualPaid(_prevState: MarkPaidState, formData: FormData): Promise<MarkPaidState> {
  'use server'
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

// Payment links are generated on demand only - never automatically when an
// invoice is created - so the admin can finalize/edit the invoice first and
// only generate one once confident the total is correct. Stripe's own
// hosted checkout page (Checkout Sessions) collects the card; no payment
// data ever touches this app. Checks for an existing Square link first
// purely to honor one already sent before the Stripe cutover - new links
// are always Stripe going forward.
async function generatePaymentLink(_prevState: GenerateLinkState, formData: FormData): Promise<GenerateLinkState> {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const invoiceId = (formData.get('invoice_id') as string) || ''
  if (!invoiceId) return { success: false, message: 'Missing invoice id.' }

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, invoice_number, amount, customer_email, customer_id, square_payment_link_url, stripe_payment_link_url')
    .eq('id', invoiceId)
    .maybeSingle()
  if (!invoice) return { success: false, message: 'Invoice not found.' }
  if (invoice.square_payment_link_url) {
    return { success: true, message: 'Payment link already exists.', url: invoice.square_payment_link_url }
  }
  if (invoice.stripe_payment_link_url) {
    return { success: true, message: 'Payment link already exists.', url: invoice.stripe_payment_link_url }
  }

  const invoiceNumber = invoice.invoice_number || invoiceId.slice(0, 8)
  const amountCents = Math.round((Number(invoice.amount) || 0) * 100)
  if (amountCents <= 0) {
    return { success: false, message: 'This invoice has no positive total to charge.' }
  }

  let buyerEmail = invoice.customer_email
  if (!buyerEmail && invoice.customer_id) {
    const { data: customer } = await supabase.from('customers').select('email').eq('id', invoice.customer_id).maybeSingle()
    buyerEmail = customer?.email ?? null
  }

  const result = await createStripeCheckoutSession({
    invoiceNumber,
    amountCents,
    buyerEmail,
    redirectUrl: 'https://app.savagechainsaws.com/invoices',
  })
  if (!result.ok) return { success: false, message: result.error }

  await supabase
    .from('invoices')
    .update({
      stripe_checkout_session_id: result.sessionId,
      stripe_payment_link_url: result.url,
    })
    .eq('id', invoiceId)
  revalidatePath('/invoices')

  return { success: true, message: 'Payment link generated.', url: result.url }
}

// Manual fallback for payment-status sync, alongside the webhook (see
// app/api/webhooks/stripe/route.ts) - checks whichever processor this
// invoice's link was actually created through, rather than assuming
// payment happened just because a link was generated or opened.
async function checkPaymentStatus(_prevState: CheckStatusState, formData: FormData): Promise<CheckStatusState> {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const invoiceId = (formData.get('invoice_id') as string) || ''
  if (!invoiceId) return { success: false, message: 'Missing invoice id.' }

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, square_order_id, stripe_checkout_session_id, paid_at')
    .eq('id', invoiceId)
    .maybeSingle()
  if (!invoice) return { success: false, message: 'Invoice not found.' }
  if (invoice.paid_at) return { success: true, message: 'Already marked paid.', paid: true }
  if (!invoice.stripe_checkout_session_id && !invoice.square_order_id) {
    return { success: false, message: 'No payment link generated yet.' }
  }

  const result = invoice.stripe_checkout_session_id
    ? await getStripeSessionPaidStatus(invoice.stripe_checkout_session_id)
    : await getSquareOrderPaidStatus(invoice.square_order_id as string)
  if (!result.ok) return { success: false, message: result.error }

  if (result.paid) {
    const paidVia = invoice.stripe_checkout_session_id ? 'stripe' : 'square'
    await supabase.from('invoices').update({ paid_at: new Date().toISOString(), paid_via: paidVia }).eq('id', invoiceId)
    revalidatePath('/invoices')
    return { success: true, message: 'Payment confirmed - marked Paid.', paid: true }
  }
  return { success: true, message: 'Not paid yet.', paid: false }
}

// Admin-only running record of every invoice ever generated (per-unit and
// standalone), for the admin's own tax/bookkeeping use - a plain list
// pulled straight from the invoices table rather than having to open each
// unit individually. See app/api/invoice/route.ts and
// app/api/invoice/custom/route.ts for where these rows get written.
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const { supabase, user, isAdmin } = await getSessionInfo()
  if (!user || !isAdmin) redirect('/login')

  const params = await searchParams
  const view = params.view === 'archived' ? 'archived' : 'active'

  // For the "+ New Invoice" modal's customer-picker (see
  // CreateCustomInvoiceForm) - same shape/fields as the dashboard's own
  // fetch for the same form (app/page.tsx).
  const { data: customers } = await supabase.from('customers').select('id, name, email, phone').order('name')
  const defaultTaxRatePercent = await getDefaultTaxRatePercent(supabase)

  const { data: invoices } = await supabase
    .from('invoices')
    .select(
      'id, customer_id, customer_name, customer_email, invoice_number, amount, description, status, pdf_url, created_at, sent_at, sent_to, square_payment_link_url, stripe_payment_link_url, paid_at, paid_via, archived_at, unit_id, line_items, sales_tax_rate, card_surcharge_amount, labor_type, payment_plan_offered, notes, units(invoice_url, status, model, equipment_type, serial_number, nickname, customers(name, email)), customers(name, email, payment_plans_enabled), invoice_payment_plans(id, installment_count, frequency, status, invoice_installments(id, sequence, amount, due_date, paid_at, paid_via, square_payment_link_url, stripe_payment_link_url))'
    )
    .order('created_at', { ascending: false })

  const rows = (invoices || []).map(inv => {
    const unit = inv.units as unknown as {
      invoice_url?: string | null
      status?: string | null
      model?: string | null
      equipment_type?: string | null
      serial_number?: string | null
      nickname?: string | null
      customers?: { name?: string; email?: string } | null
    } | null
    const unitCustomer = unit?.customers
    const directCustomer = inv.customers as unknown as { name?: string; email?: string; payment_plans_enabled?: boolean } | null
    const displayName = inv.customer_name || directCustomer?.name || unitCustomer?.name || 'Unknown Customer'
    const plan = (inv.invoice_payment_plans as unknown as {
      id: string
      installment_count: number
      frequency: string
      status: string
      invoice_installments: {
        id: string
        sequence: number
        amount: number
        due_date: string | null
        paid_at: string | null
        paid_via: string | null
        square_payment_link_url: string | null
        stripe_payment_link_url: string | null
      }[]
    }[] | null)?.[0] || null
    // Prefers what was actually on the PDF at send time (customer_email,
    // captured at generation - see app/api/invoice/*.ts) over the linked
    // customer record's current email, so the prefill matches what the
    // customer was billed as, falling back to the record for older
    // invoices generated before customer_email existed.
    const defaultEmail = inv.customer_email || directCustomer?.email || unitCustomer?.email || ''
    const pdfUrl = inv.pdf_url || unit?.invoice_url || null
    const paidAt = inv.paid_at as string | null
    const archivedAt = inv.archived_at as string | null
    return {
      id: inv.id as string,
      date: inv.created_at as string,
      invoiceNumber: (inv.invoice_number as string) || (inv.description as string) || '—',
      customerName: displayName,
      customerId: inv.customer_id as string | null,
      defaultEmail,
      amount: Number(inv.amount) || 0,
      status: (inv.status as string) || 'sent',
      pdfUrl,
      sentAt: inv.sent_at as string | null,
      sentTo: inv.sent_to as string | null,
      paymentLinkUrl: (inv.square_payment_link_url || inv.stripe_payment_link_url) as string | null,
      paidAt,
      paidVia: inv.paid_via as string | null,
      archivedAt,
      unitId: inv.unit_id as string | null,
      // Always kept, even once the unit's been picked up - Jesse still
      // needs to see which saw an unpaid balance belongs to. Only whether
      // it's clickable depends on status: a unit flips to 'Fleet' once
      // picked up, and the dashboard's "All Units - Repair Flow" accordion
      // (what the deep-link below opens) excludes Fleet units entirely, so
      // linking to one there would land on a page whose target panel never
      // renders - unitLinkable false just drops the link, never the label.
      unitLabel: unit ? unitLabel(unit) : null,
      unitLinkable: !!(unit && unit.status !== 'Fleet'),
      lineItems: inv.line_items as { description: string; amount: number }[] | null,
      taxRatePercent: Number(inv.sales_tax_rate) || 0,
      cardSurchargeAmount: Number(inv.card_surcharge_amount) || 0,
      laborType: (inv.labor_type as 'STLA' | 'NTSTLA' | null) || null,
      notes: inv.notes as string | null,
      // Paid invoices archive automatically the moment paid_at is set - no
      // separate "move to archive" step needed, the view filter below is
      // the whole mechanism. archived_at lets the admin also archive an
      // invoice that isn't paid (e.g. cancelled/written off).
      isArchived: !!paidAt || !!archivedAt,
      paymentPlansEnabledForCustomer: !!directCustomer?.payment_plans_enabled,
      paymentPlanOffered: !!inv.payment_plan_offered,
      paymentPlan: plan
        ? {
            id: plan.id,
            installmentCount: plan.installment_count,
            frequency: plan.frequency,
            status: plan.status,
            installments: [...plan.invoice_installments]
              .sort((a, b) => a.sequence - b.sequence)
              .map(i => ({
                id: i.id,
                sequence: i.sequence,
                amount: Number(i.amount) || 0,
                dueDate: i.due_date,
                paidAt: i.paid_at,
                paidVia: i.paid_via,
                paymentLinkUrl: i.square_payment_link_url || i.stripe_payment_link_url,
              })),
          }
        : null,
    }
  })

  const activeRows = rows.filter(r => !r.isArchived)
  const archivedRows = rows.filter(r => r.isArchived)
  // Active invoices on a payment-plan track sit there for a while by design
  // (weekly/biweekly/monthly installments, or still waiting on the customer
  // to even pick a schedule) rather than a one-time unpaid balance - bumped
  // to the bottom of their own bracket instead of mixed in with invoices
  // actually awaiting a single payment, so the main list only shows what
  // needs attention right now. Covers both an already-running plan AND one
  // merely offered (payment_plan_offered) but not yet chosen - the moment
  // Jesse diverts an invoice off the full-price track, it belongs here.
  const isPaymentPlanRow = (r: typeof activeRows[number]) =>
    (r.paymentPlan && r.paymentPlan.status === 'Active') || r.paymentPlanOffered
  const nonPlanActiveRows = activeRows.filter(r => !isPaymentPlanRow(r))
  const planActiveRows = activeRows.filter(isPaymentPlanRow)
  const visibleRows = view === 'archived' ? archivedRows : [...nonPlanActiveRows, ...planActiveRows]
  const paymentPlanDividerIndex = view === 'archived' || planActiveRows.length === 0 ? -1 : nonPlanActiveRows.length

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const totalThisMonth = rows
    .filter(r => new Date(r.date) >= monthStart)
    .reduce((sum, r) => sum + r.amount, 0)
  const totalAllTime = rows.reduce((sum, r) => sum + r.amount, 0)
  const pendingTotal = activeRows.reduce((sum, r) => sum + r.amount, 0)
  // "Collected" means actually paid, not just archived - a manually
  // archived-but-unpaid invoice sits in the Archived tab too, but its
  // amount was never actually taken in, so it's excluded from this sum.
  const collectedTotal = rows.filter(r => r.paidAt).reduce((sum, r) => sum + r.amount, 0)

  return (
    <main className="min-h-screen bg-zinc-950 text-white p-4 sm:p-6 md:p-10">
      {/* Wider than the rest of the app's max-w-5xl pages on purpose - this
          table has a lot of columns plus a dense row of payment/admin
          actions, and capping it at 1024px forced horizontal scroll even
          on a full-width desktop monitor. max-w-7xl gives it room to lay
          out flat on standard screens (1440px+) instead. */}
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/images/logo.png" alt="" className="h-10 w-10 object-contain" />
            <div>
              <h1 className="text-2xl font-bold">
                SAVAGE <span className="text-orange-500">CHAINSAWS</span>
              </h1>
              <p className="text-sm text-gray-400">All Invoices</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <CreateInvoiceButton
              customers={(customers || []).map(c => ({ id: c.id, name: c.name, email: c.email, phone: c.phone }))}
              defaultTaxRatePercent={defaultTaxRatePercent}
            />
            <Link
              href="/"
              className="border border-zinc-700 hover:border-orange-500 text-sm px-4 py-2 rounded-lg transition whitespace-nowrap"
            >
              ← Back to Dashboard
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase">Invoiced This Month</p>
            <p className="text-3xl font-bold text-orange-400">${totalThisMonth.toFixed(2)}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase">Invoiced All-Time</p>
            <p className="text-3xl font-bold text-white">${totalAllTime.toFixed(2)}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase">Total Invoices</p>
            <p className="text-3xl font-bold text-white">{rows.length}</p>
          </div>
        </div>

        {/* Active/Archived is a URL param (?view=), not client state, so the
            filtered table is still rendered server-side straight from
            Supabase like the rest of this page - a paid invoice needs no
            extra step to "move" itself into the archive, it just stops
            matching the Active filter (paid_at/archived_at both null). */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-1 gap-1 self-start">
            <Link
              href="/invoices?view=active"
              className={`text-sm px-3 py-1.5 rounded-md transition whitespace-nowrap ${
                view === 'active' ? 'bg-orange-500 text-white font-medium' : 'text-gray-400 hover:text-white'
              }`}
            >
              Active Invoices ({activeRows.length})
            </Link>
            <Link
              href="/invoices?view=archived"
              className={`text-sm px-3 py-1.5 rounded-md transition whitespace-nowrap ${
                view === 'archived' ? 'bg-orange-500 text-white font-medium' : 'text-gray-400 hover:text-white'
              }`}
            >
              Archived Invoices ({archivedRows.length})
            </Link>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 uppercase">
              {view === 'archived' ? 'Total Collected (Archived)' : 'Total Pending Revenue'}
            </p>
            <p className={`text-2xl font-bold ${view === 'archived' ? 'text-green-400' : 'text-orange-400'}`}>
              ${(view === 'archived' ? collectedTotal : pendingTotal).toFixed(2)}
            </p>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-zinc-800">
            <h2 className="text-lg font-semibold text-orange-400">
              {view === 'archived' ? 'Archived Invoices' : 'Active Invoices'}
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              {view === 'archived'
                ? 'Paid (or manually archived) - tucked away until you need them.'
                : 'Unpaid and awaiting payment, most recent first.'}
            </p>
          </div>
          {/* Table + horizontal scroll below sm: no amount of compacting keeps an
              8-column row with this many action buttons under a phone's width,
              and worse, the scrollbar-visibility fix a few rows down doesn't
              actually work on iOS Safari - it ignores ::-webkit-scrollbar
              styling for touch-scrolled elements, and doesn't support
              scrollbar-width at all, so there's no way to see or discover
              there's more to scroll to on an iPhone. Below sm:, a stacked
              card per invoice (see the sm:hidden block after this one) avoids
              horizontal scrolling entirely - the exact same action components,
              just with a full phone width to flex-wrap into instead of
              competing for space in one table row. */}
          <div className="hidden sm:block overflow-x-auto [scrollbar-width:thin] [scrollbar-color:theme(colors.zinc.700)_theme(colors.zinc.900)] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-zinc-900 [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar-thumb]:rounded-full">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-zinc-800">
                  <th className="px-3 sm:px-4 py-2">Date</th>
                  <th className="px-2 py-2">Invoice #</th>
                  <th className="px-2 py-2">Customer</th>
                  <th className="px-2 py-2">Unit</th>
                  <th className="px-2 py-2 text-right">Total</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Sent</th>
                  <th className="px-2 py-2">Payment</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {visibleRows.map((r, i) => (
                  <Fragment key={r.id}>
                  {i === paymentPlanDividerIndex && (
                    <tr>
                      <td colSpan={9} className="px-3 sm:px-4 pt-4 pb-2">
                        <p className="text-xs text-blue-400 uppercase tracking-wider font-semibold">
                          Payment Plans ({planActiveRows.length})
                        </p>
                      </td>
                    </tr>
                  )}
                  <tr className="hover:bg-zinc-800/40">
                    <td className="px-3 sm:px-4 py-2 text-gray-300 whitespace-nowrap">
                      {new Date(r.date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })}
                    </td>
                    <td className="px-2 py-2 text-gray-300 whitespace-nowrap">{r.invoiceNumber}</td>
                    <td className="px-2 py-2 font-medium max-w-[140px] truncate" title={r.customerName}>
                      {r.customerName}
                    </td>
                    <td className="px-2 py-2 max-w-[140px] truncate">
                      {r.unitId && r.unitLabel ? (
                        r.unitLinkable ? (
                          <Link
                            href={`/?customer=${r.customerId}&open=${r.unitId}`}
                            className="text-orange-400 hover:text-orange-300 underline"
                            title={`Open ${r.unitLabel} in the repair queue`}
                          >
                            {r.unitLabel}
                          </Link>
                        ) : (
                          <span className="text-gray-400" title="Already picked up">{r.unitLabel}</span>
                        )
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-bold text-orange-400 whitespace-nowrap">${r.amount.toFixed(2)}</td>
                    <td className="px-2 py-2 text-gray-400 capitalize">{r.status}</td>
                    <td className="px-2 py-2 text-gray-400 whitespace-nowrap">
                      {r.sentAt ? (
                        <span className="text-green-400" title={`Sent to ${r.sentTo}`}>
                          {new Date(r.sentAt).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
                        </span>
                      ) : (
                        <span className="text-gray-600">Not Sent</span>
                      )}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {r.paidAt ? (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-green-500/20 text-green-400"
                          title={r.paidVia === 'stripe' ? 'Paid online via Stripe' : r.paidVia === 'square' ? 'Paid online via Square' : 'Marked paid manually'}
                        >
                          Paid
                        </span>
                      ) : (
                        <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-zinc-700 text-gray-300">
                          Unpaid
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <div className="flex flex-wrap items-start justify-end gap-1.5">
                        {r.pdfUrl ? (
                          <a
                            href={r.pdfUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-orange-400 hover:text-orange-300 pt-1"
                          >
                            PDF
                          </a>
                        ) : (
                          <span className="text-xs text-gray-600 pt-1">No PDF</span>
                        )}
                        <EditInvoiceButton
                          invoiceId={r.id}
                          invoiceNumber={r.invoiceNumber}
                          amount={r.amount}
                          lineItems={r.lineItems}
                          taxRatePercent={r.taxRatePercent}
                          includeCardSurcharge={r.cardSurchargeAmount > 0}
                          laborType={r.laborType}
                          isPaid={!!r.paidAt}
                          hasPaymentLink={!!r.paymentLinkUrl}
                          unitLabel={r.unitLabel}
                          unitId={r.unitId}
                          customers={(customers || []).map(c => ({ id: c.id, name: c.name, email: c.email, phone: c.phone }))}
                          customerId={r.customerId}
                          customerName={r.customerName}
                          customerEmail={r.defaultEmail}
                          notes={r.notes}
                        />
                        {r.pdfUrl && (
                          <SendInvoiceButton
                            invoiceId={r.id}
                            defaultEmail={r.defaultEmail}
                            alreadySent={!!r.sentAt}
                            action={sendInvoiceEmail}
                          />
                        )}
                        <InvoicePaymentActions
                          invoiceId={r.id}
                          paymentLinkUrl={r.paymentLinkUrl}
                          isPaid={!!r.paidAt}
                          generateAction={generatePaymentLink}
                          checkStatusAction={checkPaymentStatus}
                        />
                        <MarkPaidToggle invoiceId={r.id} isPaid={!!r.paidAt} action={toggleManualPaid} />
                        {/* Only offered for unpaid invoices - a paid one is already
                            archived by its paid_at, and un-archiving it here would
                            do nothing (it'd still show as archived via paid_at),
                            which is confusing. "Mark Unpaid" is the real undo for those. */}
                        {!r.paidAt && (
                          <ArchiveToggle invoiceId={r.id} isArchived={!!r.archivedAt} action={toggleArchived} />
                        )}
                        <DeleteInvoiceButton
                          invoiceId={r.id}
                          invoiceNumber={r.invoiceNumber}
                          action={deleteInvoice}
                        />
                      </div>
                    </td>
                  </tr>
                  {(r.paymentPlan || r.paymentPlansEnabledForCustomer) && (
                    <tr className="bg-zinc-900/40">
                      <td colSpan={9} className="px-3 sm:px-4 pb-2.5">
                        <PaymentPlanSection
                          invoiceId={r.id}
                          isPaid={!!r.paidAt}
                          paymentPlansEnabledForCustomer={r.paymentPlansEnabledForCustomer}
                          paymentPlanOffered={r.paymentPlanOffered}
                          plan={r.paymentPlan}
                          startPlanAction={startPaymentPlan}
                          offerPlanAction={offerPaymentPlan}
                          generateLinkAction={generateInstallmentPaymentLink}
                          checkStatusAction={checkInstallmentPaymentStatus}
                          toggleManualPaidAction={toggleInstallmentManualPaid}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-6 py-8 text-gray-500 text-center">
                      {view === 'archived' ? 'No archived invoices yet.' : 'No active invoices - all caught up.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile: one card per invoice, full width to wrap into - see the
              comment above the table for why this exists as its own layout
              rather than just another breakpoint tweak on the table. */}
          <div className="sm:hidden divide-y divide-zinc-800">
            {visibleRows.map((r, i) => (
              <Fragment key={r.id}>
              {i === paymentPlanDividerIndex && (
                <p className="px-4 pt-4 pb-1 text-xs text-blue-400 uppercase tracking-wider font-semibold">
                  Payment Plans ({planActiveRows.length})
                </p>
              )}
              <div className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{r.invoiceNumber}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(r.date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })}
                    </p>
                  </div>
                  <p className="text-lg font-bold text-orange-400 whitespace-nowrap">${r.amount.toFixed(2)}</p>
                </div>

                <p className="font-medium text-sm truncate" title={r.customerName}>{r.customerName}</p>

                {r.unitId && r.unitLabel && (
                  r.unitLinkable ? (
                    <Link
                      href={`/?customer=${r.customerId}&open=${r.unitId}`}
                      className="text-xs text-orange-400 hover:text-orange-300 underline inline-block"
                      title={`Open ${r.unitLabel} in the repair queue`}
                    >
                      {r.unitLabel}
                    </Link>
                  ) : (
                    <span className="text-xs text-gray-400 inline-block" title="Already picked up">{r.unitLabel}</span>
                  )
                )}

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="text-gray-400 capitalize">{r.status}</span>
                  {r.sentAt ? (
                    <span className="text-green-400" title={`Sent to ${r.sentTo}`}>
                      Sent {new Date(r.sentAt).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
                    </span>
                  ) : (
                    <span className="text-gray-600">Not Sent</span>
                  )}
                  {r.paidAt ? (
                    <span
                      className="px-1.5 py-0.5 rounded-full font-medium bg-green-500/20 text-green-400"
                      title={r.paidVia === 'stripe' ? 'Paid online via Stripe' : r.paidVia === 'square' ? 'Paid online via Square' : 'Marked paid manually'}
                    >
                      Paid
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded-full font-medium bg-zinc-700 text-gray-300">Unpaid</span>
                  )}
                </div>

                <div className="flex flex-wrap items-start gap-1.5 pt-1">
                  {r.pdfUrl ? (
                    <a
                      href={r.pdfUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-orange-400 hover:text-orange-300 pt-1"
                    >
                      PDF
                    </a>
                  ) : (
                    <span className="text-xs text-gray-600 pt-1">No PDF</span>
                  )}
                  <EditInvoiceButton
                    invoiceId={r.id}
                    invoiceNumber={r.invoiceNumber}
                    amount={r.amount}
                    lineItems={r.lineItems}
                    taxRatePercent={r.taxRatePercent}
                    includeCardSurcharge={r.cardSurchargeAmount > 0}
                    laborType={r.laborType}
                    isPaid={!!r.paidAt}
                    hasPaymentLink={!!r.paymentLinkUrl}
                    unitLabel={r.unitLabel}
                    unitId={r.unitId}
                    customers={(customers || []).map(c => ({ id: c.id, name: c.name, email: c.email, phone: c.phone }))}
                    customerId={r.customerId}
                    customerName={r.customerName}
                    customerEmail={r.defaultEmail}
                    notes={r.notes}
                  />
                  {r.pdfUrl && (
                    <SendInvoiceButton
                      invoiceId={r.id}
                      defaultEmail={r.defaultEmail}
                      alreadySent={!!r.sentAt}
                      action={sendInvoiceEmail}
                    />
                  )}
                  <InvoicePaymentActions
                    invoiceId={r.id}
                    paymentLinkUrl={r.paymentLinkUrl}
                    isPaid={!!r.paidAt}
                    generateAction={generatePaymentLink}
                    checkStatusAction={checkPaymentStatus}
                  />
                  <MarkPaidToggle invoiceId={r.id} isPaid={!!r.paidAt} action={toggleManualPaid} />
                  {!r.paidAt && (
                    <ArchiveToggle invoiceId={r.id} isArchived={!!r.archivedAt} action={toggleArchived} />
                  )}
                  <DeleteInvoiceButton
                    invoiceId={r.id}
                    invoiceNumber={r.invoiceNumber}
                    action={deleteInvoice}
                  />
                </div>

                {(r.paymentPlan || r.paymentPlansEnabledForCustomer) && (
                  <PaymentPlanSection
                    invoiceId={r.id}
                    isPaid={!!r.paidAt}
                    paymentPlansEnabledForCustomer={r.paymentPlansEnabledForCustomer}
                    paymentPlanOffered={r.paymentPlanOffered}
                    plan={r.paymentPlan}
                    startPlanAction={startPaymentPlan}
                    offerPlanAction={offerPaymentPlan}
                    generateLinkAction={generateInstallmentPaymentLink}
                    checkStatusAction={checkInstallmentPaymentStatus}
                    toggleManualPaidAction={toggleInstallmentManualPaid}
                  />
                )}
              </div>
              </Fragment>
            ))}
            {visibleRows.length === 0 && (
              <p className="px-6 py-8 text-gray-500 text-center text-sm">
                {view === 'archived' ? 'No archived invoices yet.' : 'No active invoices - all caught up.'}
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

import { NextRequest, NextResponse } from 'next/server'
import { getSessionInfo } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createStripeCheckoutSession } from '@/lib/stripe'
import { computeInstallmentAmounts, computeDueDates, type PlanFrequency } from '@/lib/paymentPlans'

// Customer-facing counterpart to startPaymentPlan in app/invoices/page.tsx -
// that one is the admin picking the schedule themselves; this is the
// customer picking their own installment count/frequency on an invoice the
// admin has already flagged as eligible (invoices.payment_plan_offered),
// since they're the ones who have to make the payments fit their own cash
// flow. Ownership is always derived from the logged-in customer's own auth
// session, never trusted from the client, so this can only ever act on that
// customer's own invoice.
//
// Reads use the caller's own session-bound client (RLS-safe). The actual
// writes need the admin/service-role client instead - invoice_payment_plans
// and invoice_installments only have an RLS policy letting admins write, not
// customers, and adding a customer-writable INSERT policy that correctly
// re-checks "invoice is mine, offered, unpaid, and has no plan yet" is far
// more failure-prone than doing those exact checks here in code (already
// done above/below) and writing through the service role once they pass.
export async function POST(request: NextRequest) {
  const { supabase, user } = await getSessionInfo()
  if (!user) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }
  const adminClient = createAdminClient()
  if (!adminClient) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured yet.' }, { status: 500 })
  }

  const { data: customer } = await supabase
    .from('customers')
    .select('id, email, payment_plans_enabled')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (!customer) {
    return NextResponse.json({ error: 'No customer record on this account.' }, { status: 403 })
  }
  if (!customer.payment_plans_enabled) {
    return NextResponse.json({ error: 'Payment plans are not enabled on this account.' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const invoiceId = (body?.invoice_id as string) || ''
  const installmentCount = Number(body?.installment_count) || 0
  const frequency = (body?.frequency as string) || ''
  if (!invoiceId) return NextResponse.json({ error: 'Missing invoice id.' }, { status: 400 })
  if (![2, 3, 4, 6].includes(installmentCount)) {
    return NextResponse.json({ error: 'Pick 2, 3, 4, or 6 installments.' }, { status: 400 })
  }
  if (!['weekly', 'biweekly', 'monthly'].includes(frequency)) {
    return NextResponse.json({ error: 'Invalid frequency.' }, { status: 400 })
  }

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, invoice_number, amount, paid_at, customer_id, payment_plan_offered')
    .eq('id', invoiceId)
    .maybeSingle()
  if (!invoice || invoice.customer_id !== customer.id) {
    return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 })
  }
  if (invoice.paid_at) return NextResponse.json({ error: 'This invoice is already paid.' }, { status: 400 })
  if (!invoice.payment_plan_offered) {
    return NextResponse.json({ error: 'A payment plan is not available for this invoice.' }, { status: 403 })
  }

  const { data: existingPlan } = await supabase
    .from('invoice_payment_plans')
    .select('id')
    .eq('invoice_id', invoiceId)
    .maybeSingle()
  if (existingPlan) return NextResponse.json({ error: 'A payment plan already exists for this invoice.' }, { status: 400 })

  const total = Number(invoice.amount) || 0
  if (total <= 0) return NextResponse.json({ error: 'This invoice has no positive total to split.' }, { status: 400 })
  const amounts = computeInstallmentAmounts(total, installmentCount)
  const dueDates = computeDueDates(new Date(), installmentCount, frequency as PlanFrequency)

  const { data: plan, error: planError } = await adminClient
    .from('invoice_payment_plans')
    .insert({ invoice_id: invoiceId, installment_count: installmentCount, frequency })
    .select('id')
    .single()
  if (planError || !plan) {
    return NextResponse.json({ error: planError?.message || 'Could not create payment plan.' }, { status: 500 })
  }

  const { data: installments, error: installError } = await adminClient
    .from('invoice_installments')
    .insert(
      amounts.map((amount, i) => ({
        plan_id: plan.id,
        invoice_id: invoiceId,
        sequence: i + 1,
        amount,
        due_date: dueDates[i],
      }))
    )
    .select('id, sequence, amount')
  if (installError || !installments) {
    await adminClient.from('invoice_payment_plans').delete().eq('id', plan.id)
    return NextResponse.json({ error: installError?.message || 'Could not create installments.' }, { status: 500 })
  }

  // The first installment is due immediately - generate its Stripe link
  // right away so the customer can pay it in the same visit, rather than
  // making them come back after Jesse manually generates one.
  const first = installments.find(i => i.sequence === 1)
  if (first) {
    const amountCents = Math.round((Number(first.amount) || 0) * 100)
    const invoiceNumber = invoice.invoice_number || invoiceId.slice(0, 8)
    const result = await createStripeCheckoutSession({
      invoiceNumber: `${invoiceNumber}-1`,
      amountCents,
      buyerEmail: customer.email,
      redirectUrl: 'https://app.savagechainsaws.com/customer',
    })
    if (result.ok) {
      await adminClient
        .from('invoice_installments')
        .update({ stripe_checkout_session_id: result.sessionId, stripe_payment_link_url: result.url })
        .eq('id', first.id)
    }
    // A failed link here isn't fatal - the plan is still created, and the
    // admin's own "Get Link" fallback on the invoices page can generate it.
  }

  return NextResponse.json({ success: true })
}

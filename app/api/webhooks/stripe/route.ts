import { NextRequest, NextResponse } from 'next/server'
import { stripeWebhookClient } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'

// Mirrors app/api/webhooks/square/route.ts exactly, replacing Square's
// hand-rolled HMAC check with Stripe's own SDK verification (constructEvent
// throws on a bad/missing signature, which is what stops someone else from
// forging a fake "payment completed" event here). Same fallback story: the
// admin's manual "Check Payment Status" button (see app/invoices/page.tsx)
// covers whenever this isn't configured yet (STRIPE_WEBHOOK_SECRET not set)
// or a webhook delivery is missed.
export async function POST(request: NextRequest) {
  const stripe = stripeWebhookClient()
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!stripe || !webhookSecret) {
    return NextResponse.json({ error: 'Stripe webhook is not configured' }, { status: 500 })
  }

  const rawBody = await request.text()
  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
  }

  let event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // checkout.session.completed fires for card and most instant payment
  // methods; checkout.session.async_payment_succeeded covers delayed
  // methods (e.g. bank debits) that complete later - both mean the same
  // thing here, so both are treated identically.
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object as { id: string; payment_status?: string }
    if (session.payment_status === 'paid' && session.id) {
      const admin = createAdminClient()
      if (admin) {
        await admin
          .from('invoices')
          .update({ paid_at: new Date().toISOString(), paid_via: 'stripe' })
          .eq('stripe_checkout_session_id', session.id)
          .is('paid_at', null)
        // Rentals reuse the same stripe_checkout_session_id/paid_at shape
        // as invoices (see app/rentals/page.tsx) for whichever charge cycle
        // is currently outstanding - pickup charge or post-return balance.
        await admin
          .from('rentals')
          .update({ paid_at: new Date().toISOString(), paid_via: 'stripe' })
          .eq('stripe_checkout_session_id', session.id)
          .is('paid_at', null)

        // A payment plan installment (see app/invoices/page.tsx) - once
        // every installment on the plan clears, the parent invoice itself
        // is marked Paid too, same as maybeCompletePlan does for the
        // admin's own manual/Check Status paths.
        const { data: paidInstallment } = await admin
          .from('invoice_installments')
          .update({ paid_at: new Date().toISOString(), paid_via: 'stripe' })
          .eq('stripe_checkout_session_id', session.id)
          .is('paid_at', null)
          .select('plan_id, invoice_id')
          .maybeSingle()
        if (paidInstallment) {
          const { data: remaining } = await admin
            .from('invoice_installments')
            .select('id')
            .eq('plan_id', paidInstallment.plan_id)
            .is('paid_at', null)
          if (remaining && remaining.length === 0) {
            await admin.from('invoice_payment_plans').update({ status: 'Completed' }).eq('id', paidInstallment.plan_id)
            await admin
              .from('invoices')
              .update({ paid_at: new Date().toISOString(), paid_via: 'stripe' })
              .eq('id', paidInstallment.invoice_id)
              .is('paid_at', null)
          }
        }
      }
    }
  }

  return NextResponse.json({ received: true })
}

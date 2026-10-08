'use server'

import { revalidatePath } from 'next/cache'
import { getSessionInfo } from '@/lib/supabase/server'
import { getSquareOrderPaidStatus } from '@/lib/square'
import { createStripeCheckoutSession, getStripeSessionPaidStatus } from '@/lib/stripe'

type GenerateLinkState = { success: boolean; message: string; url?: string } | null
type CheckStatusState = { success: boolean; message: string; paid?: boolean } | null

// Payment links are generated on demand only - never automatically when an
// invoice is created - so the admin can finalize/edit the invoice first and
// only generate one once confident the total is correct. Stripe's own
// hosted checkout page (Checkout Sessions) collects the card; no payment
// data ever touches this app. Checks for an existing Square link first
// purely to honor one already sent before the Stripe cutover - new links
// are always Stripe going forward.
export async function generatePaymentLink(_prevState: GenerateLinkState, formData: FormData): Promise<GenerateLinkState> {
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
export async function checkPaymentStatus(_prevState: CheckStatusState, formData: FormData): Promise<CheckStatusState> {
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

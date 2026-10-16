'use server'

import { revalidatePath } from 'next/cache'
import { getSessionInfo } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email'
import { CARD_SURCHARGE_DISCLOSURE } from '@/lib/billing'
import { sendPushToCustomer } from '@/lib/push'
import { createStripeCheckoutSession, getStripeSessionStatus } from '@/lib/stripe'

type SendInvoiceState = { success: boolean; message: string } | null

// Emails the already-generated PDF (from Supabase Storage, same public
// "invoices" bucket every invoice route already uploads to) to whatever
// email the admin confirms in the form (prefilled from the invoice's own
// stored customer_email, falling back to the linked customer record's
// email) - reuses the general-purpose sendEmail() Nudge already uses, but
// from service@savagechainsaws.com (a real monitored mailbox) rather than
// whatever sender other system emails default to, since this is customer-
// facing billing correspondence. Every send is BCC'd to that same inbox so
// there's always a copy on record.
//
// The email is a form field rather than looked up silently server-side
// because real production invoices (SC-0001..SC-0003) were generated
// before customer_email existed and have no linked customer_id either
// (free-form standalone invoices) - there's nothing to look up for them.
// Letting the admin see/correct the recipient here means those don't need
// to be regenerated just to become sendable.
export async function sendInvoiceEmail(_prevState: SendInvoiceState, formData: FormData): Promise<SendInvoiceState> {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const invoiceId = (formData.get('invoice_id') as string) || ''
  const recipientEmail = ((formData.get('recipient_email') as string) || '').trim()
  if (!invoiceId) return { success: false, message: 'Missing invoice id.' }
  if (!recipientEmail || !recipientEmail.includes('@')) {
    return { success: false, message: 'Enter a valid email address to send to.' }
  }

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, invoice_number, amount, pdf_url, customer_name, customer_id, customer_email, square_payment_link_url, stripe_payment_link_url, stripe_checkout_session_id, paid_at, payment_plan_offered, invoice_payment_plans(id)')
    .eq('id', invoiceId)
    .maybeSingle()
  if (!invoice) return { success: false, message: 'Invoice not found.' }
  if (!invoice.pdf_url) {
    return { success: false, message: 'This invoice has no PDF saved - regenerate it first.' }
  }

  const invoiceNumber = invoice.invoice_number || 'your invoice'
  const total = Number(invoice.amount) || 0
  const greetingName = invoice.customer_name || 'there'
  // Only included if a payment link was already generated (never auto-
  // generated here) and the invoice isn't already marked paid - a real
  // tappable button in the email body, not just something inside the PDF
  // attachment. A stored Stripe link gets a freshness check first - Checkout
  // Sessions in payment mode always expire (Stripe caps it at 24h after
  // creation, no way to extend), so an invoice sent once and resent later
  // (exactly what triggered this - see Reliable Lawn Services) would
  // otherwise embed a link that's already dead, landing the customer on
  // Stripe's "session timed out" page with no way to pay at all. A fresh
  // session is generated and saved back to the invoice in that case, same
  // as checkPaymentStatus already does for the admin's own Check Status
  // button.
  let stripePaymentLinkUrl = invoice.stripe_payment_link_url
  if (invoice.stripe_payment_link_url && invoice.stripe_checkout_session_id && !invoice.paid_at) {
    const status = await getStripeSessionStatus(invoice.stripe_checkout_session_id)
    if (!status.ok || !status.open) {
      const amountCents = Math.round(total * 100)
      let buyerEmail = invoice.customer_email
      if (!buyerEmail && invoice.customer_id) {
        const { data: customer } = await supabase.from('customers').select('email').eq('id', invoice.customer_id).maybeSingle()
        buyerEmail = customer?.email ?? null
      }
      const fresh = amountCents > 0
        ? await createStripeCheckoutSession({
            invoiceNumber,
            amountCents,
            buyerEmail,
            redirectUrl: 'https://app.savagechainsaws.com/invoices',
          })
        : { ok: false as const, error: 'No positive total to charge.' }
      if (fresh.ok) {
        await supabase
          .from('invoices')
          .update({ stripe_checkout_session_id: fresh.sessionId, stripe_payment_link_url: fresh.url })
          .eq('id', invoiceId)
        stripePaymentLinkUrl = fresh.url
      } else {
        // Falls through with the stale link rather than blocking the send
        // entirely - the PDF/total still go out, and Check Status on the
        // invoice remains available to regenerate it by hand.
        console.error('[sendInvoiceEmail] could not refresh expired Stripe link:', fresh.error)
      }
    }
  }
  const paymentLinkUrl = invoice.square_payment_link_url || stripePaymentLinkUrl
  const payNowButton = paymentLinkUrl && !invoice.paid_at
    ? `<p style="margin: 20px 0;"><a href="${paymentLinkUrl}" style="background-color:#ea580c;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">Pay Now - $${total.toFixed(2)}</a></p>
       <p style="margin: 0 0 20px; font-size: 12px; color: #666666;">${CARD_SURCHARGE_DISCLOSURE}</p>`
    : ''

  // Jesse offering a payment plan (see "Let Customer Choose" in
  // app/invoices/page.tsx) used to be invisible outside the app - the
  // customer had no way to find out unless they happened to log into the
  // portal and look. This surfaces it right in the same email that
  // otherwise only shows the full-amount Pay Now button, so "pay it all at
  // once" is never the only option the customer sees. Skipped once a plan
  // already exists (the invoice_payment_plans join below) - at that point
  // the customer already chose, so repeating the offer would be confusing.
  const hasPlanAlready = ((invoice.invoice_payment_plans as { id: string }[] | null) || []).length > 0
  const planOfferBlock = invoice.payment_plan_offered && !hasPlanAlready && !invoice.paid_at
    ? `<p style="margin: 16px 0; padding: 14px 16px; background-color:#eff6ff; border:1px solid #93c5fd; border-radius:8px; font-size:14px; color:#1e3a8a;">
         Prefer to split this into smaller payments instead of paying it all at once?
         <a href="https://app.savagechainsaws.com/customer" style="color:#1d4ed8;font-weight:bold;text-decoration:underline;">Log in to set up a payment plan</a>.
       </p>`
    : ''

  const html = `
    <p>Hi ${greetingName},</p>
    <p>Please find your invoice attached from Savage Chainsaws.</p>
    <p><strong>Invoice ${invoiceNumber}</strong><br/>Total due: <strong>$${total.toFixed(2)}</strong></p>
    ${payNowButton}
    ${planOfferBlock}
    <p>If you have any questions, just reply to this email.</p>
    <p>Thanks for choosing Savage Chainsaws!</p>
  `

  const result = await sendEmail({
    to: recipientEmail,
    bcc: 'service@savagechainsaws.com',
    from: 'Savage Chainsaws <service@savagechainsaws.com>',
    subject: `Invoice ${invoiceNumber} from Savage Chainsaws`,
    html,
    attachments: [{ filename: `invoice-${invoiceNumber}.pdf`, path: invoice.pdf_url }],
  })

  if (!result.ok) {
    return { success: false, message: `Could not send invoice: ${result.error}` }
  }

  await supabase
    .from('invoices')
    .update({ sent_at: new Date().toISOString(), sent_to: recipientEmail })
    .eq('id', invoiceId)
  revalidatePath('/invoices')

  // Best-effort, free self-hosted Web Push (see lib/push.ts) - no-ops
  // silently if this customer never opted in or has no login at all, same
  // as every other push send in this app. Piggybacks on the moment the
  // invoice email actually goes out, so a customer who doesn't check email
  // still gets pinged the second it's sent - covers the "don't check email"
  // case the badge on Active Invoices doesn't (that only shows once they
  // open the app on their own).
  if (invoice.customer_id && !invoice.paid_at) {
    await sendPushToCustomer(invoice.customer_id, {
      title: 'New invoice from Savage Chainsaws',
      body: `Invoice ${invoiceNumber} - $${total.toFixed(2)} due`,
      url: '/customer',
      tag: `invoice-${invoiceId}`,
    })
  }

  return { success: true, message: `Invoice sent to ${recipientEmail}.` }
}

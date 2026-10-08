'use server'

import { revalidatePath } from 'next/cache'
import { getSessionInfo } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email'
import { CARD_SURCHARGE_DISCLOSURE } from '@/lib/billing'
import { sendPushToCustomer } from '@/lib/push'

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
    .select('id, invoice_number, amount, pdf_url, customer_name, customer_id, square_payment_link_url, stripe_payment_link_url, paid_at')
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
  // attachment.
  const paymentLinkUrl = invoice.square_payment_link_url || invoice.stripe_payment_link_url
  const payNowButton = paymentLinkUrl && !invoice.paid_at
    ? `<p style="margin: 20px 0;"><a href="${paymentLinkUrl}" style="background-color:#ea580c;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">Pay Now - $${total.toFixed(2)}</a></p>
       <p style="margin: 0 0 20px; font-size: 12px; color: #666666;">${CARD_SURCHARGE_DISCLOSURE}</p>`
    : ''

  const html = `
    <p>Hi ${greetingName},</p>
    <p>Please find your invoice attached from Savage Chainsaws.</p>
    <p><strong>Invoice ${invoiceNumber}</strong><br/>Total due: <strong>$${total.toFixed(2)}</strong></p>
    ${payNowButton}
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

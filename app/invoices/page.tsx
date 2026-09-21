import { revalidatePath } from 'next/cache'
import { getSessionInfo } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { sendEmail } from '@/lib/email'
import { createSquarePaymentLink, getSquareOrderPaidStatus } from '@/lib/square'
import SendInvoiceButton from '../components/SendInvoiceButton'
import DeleteInvoiceButton from '../components/DeleteInvoiceButton'
import InvoicePaymentActions from '../components/InvoicePaymentActions'
import MarkPaidToggle from '../components/MarkPaidToggle'

type SendInvoiceState = { success: boolean; message: string } | null
type DeleteInvoiceState = { success: boolean; message: string } | null
type GenerateLinkState = { success: boolean; message: string; url?: string } | null
type CheckStatusState = { success: boolean; message: string; paid?: boolean } | null
type MarkPaidState = { success: boolean; message: string } | null

// Payment links are generated on demand only - never automatically when an
// invoice is created - so the admin can finalize/edit the invoice first and
// only generate one once confident the total is correct. Square's own
// hosted checkout page (Payment Links / Checkout API) collects the card;
// no payment data ever touches this app.
async function generatePaymentLink(_prevState: GenerateLinkState, formData: FormData): Promise<GenerateLinkState> {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const invoiceId = (formData.get('invoice_id') as string) || ''
  if (!invoiceId) return { success: false, message: 'Missing invoice id.' }

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, invoice_number, amount, customer_email, customer_id, square_payment_link_url')
    .eq('id', invoiceId)
    .maybeSingle()
  if (!invoice) return { success: false, message: 'Invoice not found.' }
  if (invoice.square_payment_link_url) {
    return { success: true, message: 'Payment link already exists.', url: invoice.square_payment_link_url }
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

  const result = await createSquarePaymentLink({
    invoiceNumber,
    amountCents,
    buyerEmail,
    redirectUrl: 'https://app.savagechainsaws.com/invoices',
  })
  if (!result.ok) return { success: false, message: result.error }

  await supabase
    .from('invoices')
    .update({
      square_payment_link_id: result.paymentLinkId,
      square_order_id: result.orderId,
      square_payment_link_url: result.url,
    })
    .eq('id', invoiceId)
  revalidatePath('/invoices')

  return { success: true, message: 'Payment link generated.', url: result.url }
}

// Manual fallback for payment-status sync, alongside the webhook (see
// app/api/webhooks/square/route.ts) - checks Square's own Orders API
// directly rather than assuming payment happened just because a link was
// generated or opened.
async function checkPaymentStatus(_prevState: CheckStatusState, formData: FormData): Promise<CheckStatusState> {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const invoiceId = (formData.get('invoice_id') as string) || ''
  if (!invoiceId) return { success: false, message: 'Missing invoice id.' }

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, square_order_id, paid_at')
    .eq('id', invoiceId)
    .maybeSingle()
  if (!invoice) return { success: false, message: 'Invoice not found.' }
  if (!invoice.square_order_id) return { success: false, message: 'No payment link generated yet.' }
  if (invoice.paid_at) return { success: true, message: 'Already marked paid.', paid: true }

  const result = await getSquareOrderPaidStatus(invoice.square_order_id)
  if (!result.ok) return { success: false, message: result.error }

  if (result.paid) {
    await supabase.from('invoices').update({ paid_at: new Date().toISOString(), paid_via: 'square' }).eq('id', invoiceId)
    revalidatePath('/invoices')
    return { success: true, message: 'Payment confirmed - marked Paid.', paid: true }
  }
  return { success: true, message: 'Not paid yet.', paid: false }
}

// Online payment via Square is additive, never required - a customer who
// pays by Zelle, Cash App, or tap-to-pay in person still needs the invoice
// to reflect that they've paid.
async function toggleManualPaid(_prevState: MarkPaidState, formData: FormData): Promise<MarkPaidState> {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const invoiceId = (formData.get('invoice_id') as string) || ''
  const nextPaid = formData.get('next_paid') === 'true'
  if (!invoiceId) return { success: false, message: 'Missing invoice id.' }

  const { error } = await supabase
    .from('invoices')
    .update(nextPaid ? { paid_at: new Date().toISOString(), paid_via: 'manual' } : { paid_at: null, paid_via: null })
    .eq('id', invoiceId)
  if (error) return { success: false, message: `Could not update: ${error.message}` }

  revalidatePath('/invoices')
  return { success: true, message: nextPaid ? 'Marked paid.' : 'Marked unpaid.' }
}

// Permanently removes an invoice record and its stored PDF together - the
// PDF is deleted first so a failure there (rather than a merely-missing
// file, which Supabase Storage treats as a no-op) blocks the DB delete too,
// never leaving an orphaned file with nothing left pointing at it. The
// filename is always `${invoiceId}.pdf` (see app/api/invoice/route.ts and
// app/api/invoice/custom/route.ts - both key the upload off the row's own
// id), so there's no need to parse it back out of pdf_url.
async function deleteInvoice(_prevState: DeleteInvoiceState, formData: FormData): Promise<DeleteInvoiceState> {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const invoiceId = (formData.get('invoice_id') as string) || ''
  if (!invoiceId) return { success: false, message: 'Missing invoice id.' }

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, invoice_number, pdf_url')
    .eq('id', invoiceId)
    .maybeSingle()
  if (!invoice) return { success: false, message: 'Invoice not found.' }

  if (invoice.pdf_url) {
    const { error: removeError } = await supabase.storage.from('invoices').remove([`${invoiceId}.pdf`])
    if (removeError) {
      return { success: false, message: `Could not delete the stored PDF: ${removeError.message}. Nothing was removed.` }
    }
  }

  const { error: deleteError } = await supabase.from('invoices').delete().eq('id', invoiceId)
  if (deleteError) {
    return { success: false, message: `Could not delete invoice record: ${deleteError.message}` }
  }

  revalidatePath('/invoices')
  return { success: true, message: `Invoice ${invoice.invoice_number || ''} deleted.` }
}

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
async function sendInvoiceEmail(_prevState: SendInvoiceState, formData: FormData): Promise<SendInvoiceState> {
  'use server'
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
    .select('id, invoice_number, amount, pdf_url, customer_name, square_payment_link_url, paid_at')
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
  const payNowButton = invoice.square_payment_link_url && !invoice.paid_at
    ? `<p style="margin: 20px 0;"><a href="${invoice.square_payment_link_url}" style="background-color:#ea580c;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">Pay Now - $${total.toFixed(2)}</a></p>`
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

  return { success: true, message: `Invoice sent to ${recipientEmail}.` }
}

// Admin-only running record of every invoice ever generated (per-unit and
// standalone), for the admin's own tax/bookkeeping use - a plain list
// pulled straight from the invoices table rather than having to open each
// unit individually. See app/api/invoice/route.ts and
// app/api/invoice/custom/route.ts for where these rows get written.
export default async function InvoicesPage() {
  const { supabase, user, isAdmin } = await getSessionInfo()
  if (!user || !isAdmin) redirect('/login')

  const { data: invoices } = await supabase
    .from('invoices')
    .select(
      'id, unit_id, customer_id, customer_name, customer_email, invoice_number, amount, description, status, pdf_url, created_at, sent_at, sent_to, square_payment_link_url, paid_at, paid_via, units(invoice_url, model, nickname, customers(name, email)), customers(name, email)'
    )
    .order('created_at', { ascending: false })

  const rows = (invoices || []).map(inv => {
    const unitCustomer = (inv.units as unknown as { customers?: { name?: string; email?: string } | null } | null)?.customers
    const directCustomer = inv.customers as unknown as { name?: string; email?: string } | null
    const displayName = inv.customer_name || directCustomer?.name || unitCustomer?.name || 'Unknown customer'
    // Prefers what was actually on the PDF at send time (customer_email,
    // captured at generation - see app/api/invoice/*.ts) over the linked
    // customer record's current email, so the prefill matches what the
    // customer was billed as, falling back to the record for older
    // invoices generated before customer_email existed.
    const defaultEmail = inv.customer_email || directCustomer?.email || unitCustomer?.email || ''
    const pdfUrl = inv.pdf_url || (inv.units as unknown as { invoice_url?: string } | null)?.invoice_url || null
    const unitLabel = (inv.units as unknown as { model?: string; nickname?: string } | null)
    return {
      id: inv.id as string,
      date: inv.created_at as string,
      invoiceNumber: (inv.invoice_number as string) || (inv.description as string) || '—',
      customerName: displayName,
      defaultEmail,
      amount: Number(inv.amount) || 0,
      status: (inv.status as string) || 'sent',
      pdfUrl,
      unitId: inv.unit_id as string | null,
      unitLabel: unitLabel?.nickname || unitLabel?.model || null,
      sentAt: inv.sent_at as string | null,
      sentTo: inv.sent_to as string | null,
      paymentLinkUrl: inv.square_payment_link_url as string | null,
      paidAt: inv.paid_at as string | null,
      paidVia: inv.paid_via as string | null,
    }
  })

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const totalThisMonth = rows
    .filter(r => new Date(r.date) >= monthStart)
    .reduce((sum, r) => sum + r.amount, 0)
  const totalAllTime = rows.reduce((sum, r) => sum + r.amount, 0)

  return (
    <main className="min-h-screen bg-zinc-950 text-white p-4 sm:p-6 md:p-10">
      <div className="max-w-5xl mx-auto space-y-6">
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
          <Link
            href="/"
            className="border border-zinc-700 hover:border-orange-500 text-sm px-4 py-2 rounded-lg transition"
          >
            ← Back to Dashboard
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase">Invoiced this month</p>
            <p className="text-3xl font-bold text-orange-400">${totalThisMonth.toFixed(2)}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase">Invoiced all-time</p>
            <p className="text-3xl font-bold text-white">${totalAllTime.toFixed(2)}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase">Total invoices</p>
            <p className="text-3xl font-bold text-white">{rows.length}</p>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-zinc-800">
            <h2 className="text-lg font-semibold text-orange-400">Every invoice generated</h2>
            <p className="text-xs text-gray-500 mt-1">Most recent first - for your own tax/bookkeeping records.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-zinc-800">
                  <th className="px-4 sm:px-6 py-3">Date</th>
                  <th className="px-3 py-3">Invoice #</th>
                  <th className="px-3 py-3">Customer</th>
                  <th className="px-3 py-3">Unit</th>
                  <th className="px-3 py-3 text-right">Total</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Sent</th>
                  <th className="px-3 py-3">Payment</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-zinc-800/40">
                    <td className="px-4 sm:px-6 py-3 text-gray-300 whitespace-nowrap">
                      {new Date(r.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </td>
                    <td className="px-3 py-3 text-gray-300 whitespace-nowrap">{r.invoiceNumber}</td>
                    <td className="px-3 py-3 font-medium">{r.customerName}</td>
                    <td className="px-3 py-3 text-gray-400">{r.unitLabel || '—'}</td>
                    <td className="px-3 py-3 text-right font-bold text-orange-400">${r.amount.toFixed(2)}</td>
                    <td className="px-3 py-3 text-gray-400 capitalize">{r.status}</td>
                    <td className="px-3 py-3 text-gray-400 whitespace-nowrap">
                      {r.sentAt ? (
                        <span className="text-green-400" title={`Sent to ${r.sentTo}`}>
                          {new Date(r.sentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      ) : (
                        <span className="text-gray-600">Not sent</span>
                      )}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {r.paidAt ? (
                        <span
                          className="text-xs px-2 py-1 rounded-full font-medium bg-green-500/20 text-green-400"
                          title={r.paidVia === 'square' ? 'Paid online via Square' : 'Marked paid manually'}
                        >
                          Paid
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-1 rounded-full font-medium bg-zinc-700 text-gray-300">
                          Unpaid
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex flex-wrap items-start justify-end gap-3">
                        {r.pdfUrl ? (
                          <a
                            href={r.pdfUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-orange-400 hover:text-orange-300 pt-1"
                          >
                            View PDF →
                          </a>
                        ) : (
                          <span className="text-xs text-gray-600 pt-1">No PDF saved</span>
                        )}
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
                        <DeleteInvoiceButton
                          invoiceId={r.id}
                          invoiceNumber={r.invoiceNumber}
                          action={deleteInvoice}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-6 py-8 text-gray-500 text-center">
                      No invoices generated yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  )
}

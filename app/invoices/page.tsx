import { revalidatePath } from 'next/cache'
import { getSessionInfo } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { sendEmail } from '@/lib/email'
import { createSquarePaymentLink, getSquareOrderPaidStatus } from '@/lib/square'
import { CARD_SURCHARGE_DISCLOSURE, getDefaultTaxRatePercent } from '@/lib/billing'
import SendInvoiceButton from '../components/SendInvoiceButton'
import DeleteInvoiceButton from '../components/DeleteInvoiceButton'
import InvoicePaymentActions from '../components/InvoicePaymentActions'
import MarkPaidToggle from '../components/MarkPaidToggle'
import ArchiveToggle from '../components/ArchiveToggle'
import CreateInvoiceButton from '../components/CreateInvoiceButton'

type SendInvoiceState = { success: boolean; message: string } | null
type DeleteInvoiceState = { success: boolean; message: string } | null
type GenerateLinkState = { success: boolean; message: string; url?: string } | null
type CheckStatusState = { success: boolean; message: string; paid?: boolean } | null
type MarkPaidState = { success: boolean; message: string } | null
type ArchiveState = { success: boolean; message: string } | null

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

// Lets the admin tuck an invoice into the archive without marking it paid -
// e.g. one that's been cancelled or written off and shouldn't keep cluttering
// the Active view, but also shouldn't be falsely shown as collected revenue.
// Paid invoices already archive automatically (see the view filter below,
// which treats paid_at OR archived_at as archived) - this only ever toggles
// archived_at itself, so "Mark Unpaid" on an actually-paid invoice remains
// the way to bring one back to Active, not this button.
async function toggleArchived(_prevState: ArchiveState, formData: FormData): Promise<ArchiveState> {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const invoiceId = (formData.get('invoice_id') as string) || ''
  const nextArchived = formData.get('next_archived') === 'true'
  if (!invoiceId) return { success: false, message: 'Missing invoice id.' }

  const { error } = await supabase
    .from('invoices')
    .update({ archived_at: nextArchived ? new Date().toISOString() : null })
    .eq('id', invoiceId)
  if (error) return { success: false, message: `Could not update: ${error.message}` }

  revalidatePath('/invoices')
  return { success: true, message: nextArchived ? 'Archived.' : 'Unarchived.' }
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
    ? `<p style="margin: 20px 0;"><a href="${invoice.square_payment_link_url}" style="background-color:#ea580c;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">Pay Now - $${total.toFixed(2)}</a></p>
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

  return { success: true, message: `Invoice sent to ${recipientEmail}.` }
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
      'id, customer_id, customer_name, customer_email, invoice_number, amount, description, status, pdf_url, created_at, sent_at, sent_to, square_payment_link_url, paid_at, paid_via, archived_at, units(invoice_url, customers(name, email)), customers(name, email)'
    )
    .order('created_at', { ascending: false })

  const rows = (invoices || []).map(inv => {
    const unitCustomer = (inv.units as unknown as { customers?: { name?: string; email?: string } | null } | null)?.customers
    const directCustomer = inv.customers as unknown as { name?: string; email?: string } | null
    const displayName = inv.customer_name || directCustomer?.name || unitCustomer?.name || 'Unknown Customer'
    // Prefers what was actually on the PDF at send time (customer_email,
    // captured at generation - see app/api/invoice/*.ts) over the linked
    // customer record's current email, so the prefill matches what the
    // customer was billed as, falling back to the record for older
    // invoices generated before customer_email existed.
    const defaultEmail = inv.customer_email || directCustomer?.email || unitCustomer?.email || ''
    const pdfUrl = inv.pdf_url || (inv.units as unknown as { invoice_url?: string } | null)?.invoice_url || null
    const paidAt = inv.paid_at as string | null
    const archivedAt = inv.archived_at as string | null
    return {
      id: inv.id as string,
      date: inv.created_at as string,
      invoiceNumber: (inv.invoice_number as string) || (inv.description as string) || '—',
      customerName: displayName,
      defaultEmail,
      amount: Number(inv.amount) || 0,
      status: (inv.status as string) || 'sent',
      pdfUrl,
      sentAt: inv.sent_at as string | null,
      sentTo: inv.sent_to as string | null,
      paymentLinkUrl: inv.square_payment_link_url as string | null,
      paidAt,
      paidVia: inv.paid_via as string | null,
      archivedAt,
      // Paid invoices archive automatically the moment paid_at is set - no
      // separate "move to archive" step needed, the view filter below is
      // the whole mechanism. archived_at lets the admin also archive an
      // invoice that isn't paid (e.g. cancelled/written off).
      isArchived: !!paidAt || !!archivedAt,
    }
  })

  const activeRows = rows.filter(r => !r.isArchived)
  const archivedRows = rows.filter(r => r.isArchived)
  const visibleRows = view === 'archived' ? archivedRows : activeRows

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
                  <th className="px-2 py-2 text-right">Total</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Sent</th>
                  <th className="px-2 py-2">Payment</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {visibleRows.map(r => (
                  <tr key={r.id} className="hover:bg-zinc-800/40">
                    <td className="px-3 sm:px-4 py-2 text-gray-300 whitespace-nowrap">
                      {new Date(r.date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })}
                    </td>
                    <td className="px-2 py-2 text-gray-300 whitespace-nowrap">{r.invoiceNumber}</td>
                    <td className="px-2 py-2 font-medium max-w-[140px] truncate" title={r.customerName}>
                      {r.customerName}
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
                          title={r.paidVia === 'square' ? 'Paid online via Square' : 'Marked paid manually'}
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
                ))}
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-8 text-gray-500 text-center">
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
            {visibleRows.map(r => (
              <div key={r.id} className="p-4 space-y-2">
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
                      title={r.paidVia === 'square' ? 'Paid online via Square' : 'Marked paid manually'}
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
              </div>
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

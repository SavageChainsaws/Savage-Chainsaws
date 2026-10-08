'use server'

import { revalidatePath } from 'next/cache'
import { getSessionInfo } from '@/lib/supabase/server'

type MarkPaidState = { success: boolean; message: string } | null
type ArchiveState = { success: boolean; message: string } | null
type DeleteInvoiceState = { success: boolean; message: string } | null

// Online payment via Stripe is additive, never required - a customer who
// pays by Zelle, Cash App, or tap-to-pay in person still needs the invoice
// to reflect that they've paid.
export async function toggleManualPaid(_prevState: MarkPaidState, formData: FormData): Promise<MarkPaidState> {
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
// Paid invoices already archive automatically (see the view filter in
// app/invoices/page.tsx, which treats paid_at OR archived_at as archived) -
// this only ever toggles archived_at itself, so "Mark Unpaid" on an
// actually-paid invoice remains the way to bring one back to Active, not
// this button.
export async function toggleArchived(_prevState: ArchiveState, formData: FormData): Promise<ArchiveState> {
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
export async function deleteInvoice(_prevState: DeleteInvoiceState, formData: FormData): Promise<DeleteInvoiceState> {
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

'use server'

import { revalidatePath } from 'next/cache'
import { getSessionInfo } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

type ClaimState = { success: boolean; message: string } | null
type VerifyState = { success: boolean; message: string } | null

// Zelle has no merchant API or webhook (unlike Stripe/Square) - a customer
// who pays this way self-reports the confirmation number their bank gave
// them here instead. This deliberately leaves paid_at untouched (so it
// never inflates Jesse's collected-revenue totals on an unconfirmed claim)
// - it only records the claim so the invoice can stop looking like
// something the customer still owes while Jesse checks his bank activity
// and verifies it via verifyZellePayment below.
export async function claimZellePayment(_prevState: ClaimState, formData: FormData): Promise<ClaimState> {
  const { supabase, user } = await getSessionInfo()
  if (!user) throw new Error('Not authorized')

  const invoiceId = (formData.get('invoice_id') as string) || ''
  const reference = ((formData.get('reference') as string) || '').trim()
  if (!invoiceId) return { success: false, message: 'Missing invoice id.' }
  if (!reference) return { success: false, message: 'Enter the confirmation number from your Zelle payment.' }

  // invoices RLS only grants customers SELECT on their own rows - reusing
  // that as the ownership check here means there's no second place a
  // customer/invoice relationship needs to be kept in sync with the actual
  // RLS policy. A null result means either the id is wrong or it isn't
  // this customer's invoice; either way the response is the same.
  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, paid_at')
    .eq('id', invoiceId)
    .maybeSingle()
  if (!invoice) return { success: false, message: 'Invoice not found.' }
  if (invoice.paid_at) return { success: false, message: 'This invoice is already marked paid.' }

  // invoices has no customer UPDATE policy (on purpose - see
  // verifyZellePayment), so the actual write needs the service-role
  // client, now that ownership's been confirmed above through RLS.
  const admin = createAdminClient()
  if (!admin) return { success: false, message: 'Server misconfigured - contact Jesse directly.' }

  const { error } = await admin
    .from('invoices')
    .update({ zelle_claim_reference: reference, zelle_claimed_at: new Date().toISOString() })
    .eq('id', invoiceId)
  if (error) return { success: false, message: `Could not save: ${error.message}` }

  revalidatePath('/invoices')
  return { success: true, message: "Thanks - we'll verify this and mark it paid shortly." }
}

// Admin side of the claim above. Confirm matches today's Mark Paid flow
// (paid_at + paid_via) once Jesse's checked the reference against his own
// bank deposit, just attributed to 'zelle' instead of 'manual' so the
// Payment column still shows how it actually came in. Reject clears the
// claim and puts the invoice back exactly as if nothing were ever
// submitted, for whenever the reference doesn't check out.
export async function verifyZellePayment(_prevState: VerifyState, formData: FormData): Promise<VerifyState> {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const invoiceId = (formData.get('invoice_id') as string) || ''
  const approve = formData.get('approve') === 'true'
  if (!invoiceId) return { success: false, message: 'Missing invoice id.' }

  const { error } = await supabase
    .from('invoices')
    .update(
      approve
        ? { paid_at: new Date().toISOString(), paid_via: 'zelle' }
        : { zelle_claim_reference: null, zelle_claimed_at: null }
    )
    .eq('id', invoiceId)
  if (error) return { success: false, message: `Could not update: ${error.message}` }

  revalidatePath('/invoices')
  return { success: true, message: approve ? 'Marked paid.' : 'Claim rejected - back to unpaid.' }
}

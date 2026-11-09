'use server'

import { revalidatePath } from 'next/cache'
import { getSessionInfo } from '@/lib/supabase/server'

type State = { success: boolean; message: string } | null

// The only way due_date ever gets set - never defaulted/assumed (no NET 30)
// anywhere else in the app, never backfilled by a migration. Jesse sets it
// here once he's confirmed that customer's actual payment terms; until
// then it stays null and App Bot's reminder rule (lib/bot/rules.ts) blocks
// reminders on that invoice rather than guessing a date.
export async function setInvoiceDueDate(_prevState: State, formData: FormData): Promise<State> {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const invoiceId = (formData.get('invoice_id') as string) || ''
  const dueDate = ((formData.get('due_date') as string) || '').trim() || null
  if (!invoiceId) return { success: false, message: 'Missing invoice id.' }

  const { error } = await supabase.from('invoices').update({ due_date: dueDate }).eq('id', invoiceId)
  if (error) return { success: false, message: error.message }

  revalidatePath('/invoices')
  return { success: true, message: dueDate ? 'Due date saved.' : 'Due date cleared.' }
}

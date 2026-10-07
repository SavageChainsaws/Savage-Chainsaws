'use server'

import { revalidatePath } from 'next/cache'
import { getSessionInfo } from '@/lib/supabase/server'

export async function addServiceHistoryEntry(formData: FormData) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const unitId = formData.get('unit_id') as string
  const serviceDate = formData.get('service_date') as string
  const description = (formData.get('description') as string || '').trim()
  const costRaw = formData.get('cost') as string
  if (!unitId || !description) return
  await supabase.from('service_history').insert({
    unit_id: unitId,
    service_date: serviceDate || new Date().toISOString().split('T')[0],
    description,
    cost: costRaw ? Number(costRaw) : null,
  })
  revalidatePath('/')
}

export async function deleteServiceHistoryEntry(formData: FormData) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  await supabase.from('service_history').delete().eq('id', id)
  revalidatePath('/')
}

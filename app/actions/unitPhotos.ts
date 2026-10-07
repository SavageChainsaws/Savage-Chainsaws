'use server'

import { revalidatePath } from 'next/cache'
import { getSessionInfo } from '@/lib/supabase/server'

export async function addUnitPhoto(formData: FormData) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const unitId = formData.get('unit_id') as string
  const photoUrls = (formData.getAll('photo_url') as string[]).filter(Boolean)
  if (!unitId || photoUrls.length === 0) return
  await supabase.from('unit_photos').insert(photoUrls.map(url => ({ unit_id: unitId, url })))
  revalidatePath('/')
}

export async function deleteUnitPhoto(formData: FormData) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  await supabase.from('unit_photos').delete().eq('id', id)
  revalidatePath('/')
}

// Diagnosis Findings - photos/videos the admin captures while diagnosing a
// unit, kept in the same unit_photos table as the check-in gallery but
// tagged stage: 'diagnosis' so the two never mix. Takes every file from one
// multi-select upload in a single bulk insert, rather than one row at a
// time.
export async function addDiagnosisMedia(formData: FormData) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const unitId = formData.get('unit_id') as string
  const urls = formData.getAll('media_url') as string[]
  const types = formData.getAll('media_type') as string[]
  if (!unitId || urls.length === 0) return
  const rows = urls
    .map((url, i) => ({ unit_id: unitId, url, media_type: types[i] === 'video' ? 'video' : 'photo', stage: 'diagnosis' }))
    .filter(r => r.url)
  if (rows.length === 0) return
  await supabase.from('unit_photos').insert(rows)
  revalidatePath('/')
}

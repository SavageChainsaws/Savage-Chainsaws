'use server'

import { revalidatePath } from 'next/cache'
import { getSessionInfo } from '@/lib/supabase/server'

export async function upsertUnitPartOverride(formData: FormData) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = (formData.get('id') as string) || null
  const unitId = formData.get('unit_id') as string
  const unitModel = (formData.get('unit_model') as string) || null
  const partName = (formData.get('part_name') as string || '').trim()
  const sku = (formData.get('sku') as string || '').trim().toUpperCase()
  const skuType = (formData.get('sku_type') as string) === 'Aftermarket' ? 'Aftermarket' : 'OEM'
  if (!unitId || !partName || !sku) return

  if (id) {
    await supabase
      .from('unit_part_overrides')
      .update({ part_name: partName, sku, sku_type: skuType, updated_at: new Date().toISOString() })
      .eq('id', id)
  } else {
    await supabase
      .from('unit_part_overrides')
      .upsert(
        { unit_id: unitId, part_name: partName, sku, sku_type: skuType },
        { onConflict: 'unit_id,part_name_key' }
      )
  }

  // OEM SKUs become the shared default for every unit of the same model
  // (re-running this on every save, including edits, keeps the default in
  // sync). Aftermarket SKUs are unit-only and never touch model_parts.
  if (skuType === 'OEM' && unitModel) {
    await supabase
      .from('model_parts')
      .upsert(
        { model: unitModel, part_name: partName, sku, sku_type: 'OEM' },
        { onConflict: 'model_key,part_name_key' }
      )
  }
  revalidatePath('/')
  revalidatePath('/parts')
  revalidatePath('/reports')
}

export async function deleteUnitPartOverride(formData: FormData) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  await supabase.from('unit_part_overrides').delete().eq('id', id)
  revalidatePath('/')
}

'use server'

import { revalidatePath } from 'next/cache'
import { getSessionInfo } from '@/lib/supabase/server'

// Order Sheet - a per-unit running list of STIHL part numbers built up
// during diagnosis (copy/pasted from the dealer parts catalog) so Jesse
// can take one printable sheet to the store instead of remembering
// everything. Deliberately separate from Parts & SKUs (app/page.tsx): that
// section is the fixed default-parts-per-model system used for invoice SKU
// matching, this is a disposable per-job shopping list sourced from the
// real distributor parts_catalog table. Always trusts parts_catalog for
// description/cost/retail_price when the SKU matches - never the client-
// submitted values - so a stale/edited form field can't misprice a part.
// Adding a SKU already on the sheet bumps its quantity (unique(unit_id,
// sku) + upsert) instead of creating a duplicate row.
export async function addOrderSheetItem(formData: FormData) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const unitId = formData.get('unit_id') as string
  const skuRaw = ((formData.get('sku') as string) || '').trim()
  const quantity = Math.max(1, parseInt((formData.get('quantity') as string) || '1', 10) || 1)
  if (!unitId || !skuRaw) return

  const { data: match } = await supabase
    .from('parts_catalog')
    .select('sku, description, cost, retail_price')
    .ilike('sku', skuRaw)
    .maybeSingle()

  const { data: existing } = await supabase
    .from('order_sheet_items')
    .select('id, quantity')
    .eq('unit_id', unitId)
    .eq('sku', match?.sku || skuRaw)
    .maybeSingle()

  if (existing) {
    await supabase
      .from('order_sheet_items')
      .update({ quantity: existing.quantity + quantity })
      .eq('id', existing.id)
  } else {
    await supabase.from('order_sheet_items').insert({
      unit_id: unitId,
      sku: match?.sku || skuRaw,
      description: match?.description || 'Unknown part - verify at store',
      cost: match?.cost ?? null,
      retail_price: match?.retail_price ?? null,
      quantity,
    })
  }
  revalidatePath('/')
}

export async function updateOrderSheetItemQuantity(formData: FormData) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  const quantity = Math.max(1, parseInt((formData.get('quantity') as string) || '1', 10) || 1)
  await supabase.from('order_sheet_items').update({ quantity }).eq('id', id)
  revalidatePath('/')
}

export async function deleteOrderSheetItem(formData: FormData) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  await supabase.from('order_sheet_items').delete().eq('id', id)
  revalidatePath('/')
}

export async function clearOrderSheet(formData: FormData) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const unitId = formData.get('unit_id') as string
  await supabase.from('order_sheet_items').delete().eq('unit_id', unitId)
  revalidatePath('/')
}

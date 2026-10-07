'use server'

import { revalidatePath } from 'next/cache'
import crypto from 'crypto'
import { getSessionInfo } from '@/lib/supabase/server'

type UpdateShopSettingState = { success: boolean; message: string } | null

// Backs the "Shop Settings" panel - currently just the FL sales tax rate
// (see lib/billing.ts's getDefaultTaxRatePercent), stored in shop_settings
// as a key/value row rather than hardcoded, so Jesse can change it himself
// for jobs outside Seminole County without a code deploy. Every invoice
// form still lets him override the rate per-invoice on top of whatever
// this default is.
export async function updateShopSetting(_prevState: UpdateShopSettingState, formData: FormData): Promise<UpdateShopSettingState> {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const taxRateRaw = (formData.get('fl_sales_tax_rate_percent') as string) || ''
  const taxRate = Number(taxRateRaw)
  if (!Number.isFinite(taxRate) || taxRate < 0) {
    return { success: false, message: 'Enter a valid, non-negative tax rate.' }
  }

  const { error } = await supabase
    .from('shop_settings')
    .upsert({ key: 'fl_sales_tax_rate_percent', value: String(taxRate), updated_at: new Date().toISOString() })
  if (error) return { success: false, message: `Could not save: ${error.message}` }

  revalidatePath('/')
  revalidatePath('/invoices')
  return { success: true, message: `FL Sales Tax Rate updated to ${taxRate}%.` }
}

// Rotates the secret that gates /join (see app/api/instant-signup/route.ts)
// - anyone with the OLD link immediately loses access once this runs, since
// the route compares against whatever's currently stored here. Use if a
// link ever leaks somewhere it shouldn't have.
export async function regenerateInstantSignupToken() {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const token = crypto.randomBytes(20).toString('hex')
  await supabase
    .from('shop_settings')
    .upsert({ key: 'instant_signup_token', value: token, updated_at: new Date().toISOString() })
  revalidatePath('/')
}

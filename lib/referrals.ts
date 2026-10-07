import type { getSessionInfo } from '@/lib/supabase/server'

// Case-insensitive referral code lookup, shared by every flow that can
// attach a referral_source_id to a customer (createCustomerLogin, addUnit).
// Codes are always stored/matched uppercase (see createReferralSourceLogin)
// so this is a plain equality match, never a LIKE pattern. Returns null with
// no error for a blank code (nothing to look up) as well as an unrecognized
// one (best-effort - never blocks the caller's real action over a typo'd
// code).
export async function resolveReferralCode(
  supabase: Awaited<ReturnType<typeof getSessionInfo>>['supabase'],
  formData: FormData
): Promise<string | null> {
  const raw = ((formData.get('referral_code') as string) || '').trim()
  if (!raw) return null
  const { data } = await supabase
    .from('referral_sources')
    .select('id')
    .eq('referral_code', raw.toUpperCase())
    .maybeSingle()
  return data?.id ?? null
}

import type { createClient } from './supabase/server'

// Billing rules for the multi-unit "Chainsaw Equipment Rental Agreement"
// (the printed form Jesse hands a customer renting several saws at once -
// separate from the single-unit, per-fleet-unit rental flow in
// lib/rentals.ts, which has its own different rate card). Kept in its own
// file rather than folded into lib/rentals.ts so changing one never risks
// silently changing the other's numbers.
export type RateType = 'daily' | 'three_day_package'

export const RATE_PER_UNIT_PER_DAY = 70
export const RATE_PER_UNIT_THREE_DAY_PACKAGE = 210
export const DEPOSIT_PER_UNIT = 150
export const LATE_FEE_PER_UNIT_PER_DAY = 10
// Section 4/5: liability for damage or loss is capped at this fraction of
// the unit's current STIHL USA retail price (new), not a flat dollar cap.
export const DAMAGE_LIABILITY_RETAIL_FRACTION = 0.75

export type AgreementUnit = { model: string; serialNumber: string; conditionAtPickup: string }

export function computeRentalFee(rateType: RateType, unitCount: number): number {
  const rate = rateType === 'daily' ? RATE_PER_UNIT_PER_DAY : RATE_PER_UNIT_THREE_DAY_PACKAGE
  return Math.round(rate * unitCount * 100) / 100
}

export function computeDepositAmount(unitCount: number): number {
  return Math.round(DEPOSIT_PER_UNIT * unitCount * 100) / 100
}

// Jesse's drawn signature, saved once (see OwnerSignatureSetting) and
// auto-stamped onto every new agreement after - same shop_settings
// key/value table as getDefaultTaxRatePercent (lib/billing.ts), just a
// different key. Returns null until he's saved one, in which case the
// Owner signature line prints blank for an on-paper/physical signature
// instead, same as a never-signed Renter line.
export async function getOwnerSignatureUrl(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<string | null> {
  const { data } = await supabase
    .from('shop_settings')
    .select('value')
    .eq('key', 'owner_signature_url')
    .maybeSingle()
  return data?.value || null
}

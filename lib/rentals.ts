// Shared rental billing rules, matching the printed Chainsaw Rental
// Agreement's own terms (Sections 1-4) so the app's math never drifts from
// what the customer actually signed.
export type RentalType = 'daily' | 'weekly'

export const DEFAULT_DAILY_RATE = 40
export const DEFAULT_WEEKLY_RATE = 120
export const DEFAULT_SECURITY_DEPOSIT = 150
export const DEFAULT_DAMAGE_CAP = 300
export const LATE_FEE_PER_DAY = 10
// Section 4: due back by 5 PM on the end date.
export const RETURN_DUE_HOUR = 17

// Whole calendar days between start and end (minimum 1) - the basis for
// both the daily rate and the weekly-rate week count below.
export function computeRentalDays(startDate: string, endDate: string): number {
  const start = new Date(startDate)
  const end = new Date(endDate)
  const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
  return Math.max(1, days)
}

// Weekly is a flat per-week rate, not a daily rate in disguise - a rental
// spanning into a second week (8-14 days) bills as 2 weeks, matching how a
// customer would expect "weekly" pricing to work.
export function computeRentalCharge(rentalType: RentalType, rateAmount: number, days: number): number {
  if (rentalType === 'weekly') {
    const weeks = Math.ceil(days / 7)
    return Math.round(rateAmount * weeks * 100) / 100
  }
  return Math.round(rateAmount * days * 100) / 100
}

// Section 4: "$10/day after due date" - due date is 5 PM on end_date, per
// RETURN_DUE_HOUR. Returning even a minute late starts the first day's fee;
// partial late days round up rather than being pro-rated.
export function computeLateFee(endDate: string, actualReturnDate: Date): number {
  const due = new Date(`${endDate}T00:00:00`)
  due.setHours(RETURN_DUE_HOUR, 0, 0, 0)
  if (actualReturnDate.getTime() <= due.getTime()) return 0
  const lateDays = Math.ceil((actualReturnDate.getTime() - due.getTime()) / (1000 * 60 * 60 * 24))
  return Math.round(lateDays * LATE_FEE_PER_DAY * 100) / 100
}

// Section 2: liability is capped at $300 (damage_cap_amount, snapshotted
// per-rental in case the shop-wide default changes later) regardless of
// what the admin enters for actual damage found.
export function capDamageCharge(rawAmount: number, damageCapAmount: number): number {
  return Math.max(0, Math.min(rawAmount, damageCapAmount))
}

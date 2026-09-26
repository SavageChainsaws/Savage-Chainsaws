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

// Inclusive day count between start and end (Monday to Friday is 5 days,
// not 4) - the basis for both the daily rate and the weekly-rate week
// count below.
export function computeRentalDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
  return Math.max(1, days)
}

// Prorates the rate by how long the rental actually spans: daily_rate ×
// day count, or weekly_rate × week count (partial weeks round up - a
// 10-day rental is 2 weeks, not 1.43).
export function computeRentalCharge(rentalType: RentalType, dailyRate: number, weeklyRate: number, days: number): number {
  if (rentalType === 'weekly') {
    const weeks = Math.ceil(days / 7)
    return Math.round(weeklyRate * weeks * 100) / 100
  }
  return Math.round(dailyRate * days * 100) / 100
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

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

// The same 6 numbered terms rendered in the agreement PDF (see
// lib/rentalAgreementPdf.tsx), shared so the in-app "sign before you pay"
// card a portal customer reads is never out of sync with what actually
// prints. {damageCap}/{securityDeposit} are filled in by the caller since
// those vary per rental.
export function rentalAgreementTerms(damageCap: number, securityDeposit: number): { title: string; body: string }[] {
  return [
    {
      title: '1. Renter Responsibility',
      body: 'Renter is solely responsible for all proper and safe use of the equipment, including felling, cutting, chain tension, bar and chain care, handling, and personal protective equipment. Renter will follow the STIHL owner\'s manual and all safety instructions and will not lend or sublet the equipment. Fuel: ONLY 50:1 premium gasoline mixed with 2-stroke oil. NO STRAIGHT FUEL.',
    },
    {
      title: '2. Damage and Liability',
      body: `Renter assumes full responsibility for the equipment from pickup until return, including misuse, unsafe operation or handling, improper fuel, neglect, impact damage, and any other damage, whatever the cause. Renter pays the repair cost, including parts and labor, up to the damage cap for the unit, which is 75% of the current STIHL USA retail price of that unit (new). The security deposit of $${securityDeposit.toFixed(2)} is refundable and may be applied to damage or unpaid fees. The damage cap recorded for this rental is $${damageCap.toFixed(2)}.`,
    },
    {
      title: '3. Loss or Theft',
      body: 'If the equipment is lost, stolen, or cannot be returned, Renter pays 75% of the current STIHL USA retail price of that unit (new), determined as of the date of loss. The security deposit may be applied toward this amount.',
    },
    {
      title: '4. Release and Indemnity',
      body: 'To the fullest extent permitted by Florida law, Renter releases Savage Chainsaws LLC and its owner from all claims, losses, injuries, and damages arising from the use, handling, or possession of the equipment, and agrees to indemnify and hold Owner harmless from third-party claims arising from Renter\'s use. Renter acknowledges that chainsaws are inherently dangerous and that Owner does not provide training or supervision. This release does not apply to Owner\'s gross negligence or intentional wrongdoing, or to rights that cannot be waived under Florida law.',
    },
    {
      title: '5. Return',
      body: 'Unit must be returned by 5 PM on the rental end date, clean, with the same parts and accessories as at pickup. Late return: $10 per day after the due date. Renter remains responsible for rental charges until the equipment is returned.',
    },
    {
      title: '6. Cancellation & Modifications',
      body: 'Cancellations 24+ hours before rental: full refund. Cancellations under 24 hours: 50% charge. Renter may extend the rental if equipment is available, at the continuing rate.',
    },
    {
      title: '7. Inspection & Acceptance',
      body: 'Unit has been inspected and is in good working condition. Renter accepts the unit as-is and has tested it before taking possession.',
    },
  ]
}


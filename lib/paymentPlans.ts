// Shared math for splitting an invoice into installments - kept separate
// from lib/billing.ts since that's about the charge itself (tax/surcharge),
// this is about scheduling the collection of an already-finalized total.
export type PlanFrequency = 'weekly' | 'biweekly' | 'monthly'

// Splits evenly to the cent, with any leftover rounding folded into the
// last installment so the parts always sum to exactly the original total
// (never a cent short or over from splitting $500 into 3, say).
export function computeInstallmentAmounts(total: number, count: number): number[] {
  const base = Math.floor((total / count) * 100) / 100
  const amounts = Array(count).fill(base)
  const remainder = Math.round((total - base * count) * 100) / 100
  amounts[count - 1] = Math.round((amounts[count - 1] + remainder) * 100) / 100
  return amounts
}

// Installment #1 is due immediately (today); each subsequent one lands a
// full period later - "one week he gets a payment in, another week
// another" - so a customer paying on schedule sees a new link roughly
// once per period rather than everything dumped on them at once.
export function computeDueDates(startDate: Date, count: number, frequency: PlanFrequency): string[] {
  const dates: string[] = []
  for (let i = 0; i < count; i++) {
    const d = new Date(startDate)
    if (frequency === 'monthly') {
      d.setMonth(d.getMonth() + i)
    } else {
      d.setDate(d.getDate() + (frequency === 'weekly' ? 7 : 14) * i)
    }
    dates.push(d.toISOString().slice(0, 10))
  }
  return dates
}

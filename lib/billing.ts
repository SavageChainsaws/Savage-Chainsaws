import type { createClient } from './supabase/server'

// Florida sales tax + card-surcharge rules shared by both invoice-creation
// routes (app/api/invoice/route.ts for a tracked unit, app/api/invoice/
// custom/route.ts for a standalone invoice) so the two never drift apart.
//
// Tax rule (Fla. Admin. Code 12A-1.006): once any tangible part/material is
// transferred to the customer, the ENTIRE invoice - labor included - is
// taxable, not just the parts. A labor-only invoice (no parts/materials at
// all) owes no sales tax. That same parts-present/absent split is also
// what selects the labor line's type code, carried over from Jesse's prior
// shop's POS convention:
//   STLA   = Sales Tax Labor Add-on      (parts present, labor is taxable)
//   NTSTLA = Non-Taxable [STIHL] Labor Add-on (labor-only, no parts)
export type LaborType = 'STLA' | 'NTSTLA'

export type BillingLine = { description: string; amount: number }

export type BillingBreakdown = {
  // Full pre-tax subtotal (taxableSubtotal + otherCharges) - what actually
  // shows as "Subtotal" before tax/surcharge lines.
  subtotal: number
  hasParts: boolean
  laborType: LaborType
  taxRatePercent: number
  taxAmount: number
  taxLine: BillingLine | null
  // True whenever the invoice is labor-only (no parts/materials) - the PDF
  // prints "Labor Only - No Parts or Materials Provided" whenever this is
  // set, for the audit trail Fla. Admin. Code 12A-1.006 exemption relies on.
  laborOnlyNote: boolean
  surchargeAmount: number
  surchargeLine: BillingLine | null
  grandTotal: number
}

export function computeInvoiceBilling({
  // Parts + labor only - the tax base per Fla. Admin. Code 12A-1.006 ("the
  // FULL subtotal (labor + parts combined)"). Never includes the priority
  // fee or referral discount below, since neither is a part or labor charge.
  taxableSubtotal,
  // Priority fee minus referral discount (or whatever other non-parts/labor
  // charges an invoice carries) - added to the pre-tax subtotal and to the
  // card-surcharge base (the full amount actually running through the
  // card), but never taxed.
  otherCharges,
  hasParts,
  taxRatePercent,
  includeCardSurcharge,
}: {
  taxableSubtotal: number
  otherCharges: number
  hasParts: boolean
  taxRatePercent: number
  includeCardSurcharge: boolean
}): BillingBreakdown {
  const laborType: LaborType = hasParts ? 'STLA' : 'NTSTLA'
  const subtotal = taxableSubtotal + otherCharges
  // Tax is zero for a labor-only invoice regardless of what rate was
  // entered - the rate only ever applies once parts/materials are present -
  // and is computed on parts+labor only, never on the priority fee/referral
  // discount folded into otherCharges.
  const taxAmount = hasParts ? Math.round(taxableSubtotal * (taxRatePercent / 100) * 100) / 100 : 0
  const taxLine: BillingLine | null = hasParts
    ? { description: `FL Sales Tax (${taxRatePercent}%)`, amount: taxAmount }
    : null

  // Surcharge is 3% of the full subtotal (parts + labor + priority fee -
  // referral discount) plus tax combined - the full amount that would
  // actually run through the card - never of the taxable subtotal alone,
  // and only ever added when Jesse leaves the surcharge toggle on (it's
  // meant for credit-card-via-Square payments only; he unchecks it, or
  // re-generates the invoice with it unchecked, for Zelle/Cash App/debit
  // payers).
  const surchargeAmount = includeCardSurcharge
    ? Math.round((subtotal + taxAmount) * 0.03 * 100) / 100
    : 0
  const surchargeLine: BillingLine | null =
    includeCardSurcharge && surchargeAmount > 0
      ? { description: 'Card Processing Fee (3%)', amount: surchargeAmount }
      : null

  const grandTotal = subtotal + taxAmount + surchargeAmount

  return {
    subtotal,
    hasParts,
    laborType,
    taxRatePercent,
    taxAmount,
    taxLine,
    laborOnlyNote: !hasParts,
    surchargeAmount,
    surchargeLine,
    grandTotal,
  }
}

export const CARD_SURCHARGE_DISCLOSURE =
  'A 3% card processing fee applies to credit card payments. No fee for Zelle, Cash App, or debit.'

export const LABOR_ONLY_NOTE = 'Labor Only - No Parts or Materials Provided'

export const DEFAULT_FL_SALES_TAX_RATE_PERCENT = 7

// Shop-wide default (Settings -> FL Sales Tax Rate on the dashboard),
// looked up fresh on every invoice-creation request rather than cached -
// this is exactly the "easy for Jesse to change later" lever for jobs
// outside Seminole County, and every form field that reads it also lets
// him override it per-invoice on top of whatever this returns.
export async function getDefaultTaxRatePercent(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<number> {
  const { data } = await supabase
    .from('shop_settings')
    .select('value')
    .eq('key', 'fl_sales_tax_rate_percent')
    .maybeSingle()
  const parsed = Number(data?.value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_FL_SALES_TAX_RATE_PERCENT
}

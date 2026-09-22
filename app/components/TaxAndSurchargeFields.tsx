'use client'

import { useState } from 'react'

// Shared by CreateUnitInvoiceForm and CreateCustomInvoiceForm. Renders the
// hidden fields the server actually reads (labor_type, tax_rate_percent,
// include_card_surcharge) plus a live preview - the preview's math is
// deliberately kept identical to computeInvoiceBilling() in lib/billing.ts
// so what Jesse sees here matches what the server generates; the server
// still recomputes independently rather than trusting these hidden fields
// blindly for the total (only for labor_type/tax_rate_percent/the
// surcharge toggle, which are legitimate per-invoice choices).
export default function TaxAndSurchargeFields({
  hasParts,
  taxableSubtotal,
  otherCharges = 0,
  defaultTaxRatePercent,
}: {
  hasParts: boolean
  // Parts + labor only - the tax base (Fla. Admin. Code 12A-1.006).
  taxableSubtotal: number
  // Priority fee, referral discount, etc - added to the subtotal/surcharge
  // base but never taxed. Any referral discount computed server-side isn't
  // known to this preview, so it can run slightly ahead of the final total
  // on invoices that qualify for one - the server always recomputes.
  otherCharges?: number
  defaultTaxRatePercent: number
}) {
  const [taxRatePercent, setTaxRatePercent] = useState(defaultTaxRatePercent)
  const [laborTypeOverride, setLaborTypeOverride] = useState<'STLA' | 'NTSTLA' | ''>('')
  const [includeSurcharge, setIncludeSurcharge] = useState(true)

  const laborType = laborTypeOverride || (hasParts ? 'STLA' : 'NTSTLA')
  const subtotal = taxableSubtotal + otherCharges
  const taxAmount = hasParts ? Math.round(taxableSubtotal * (taxRatePercent / 100) * 100) / 100 : 0
  const surchargeAmount = includeSurcharge ? Math.round((subtotal + taxAmount) * 0.03 * 100) / 100 : 0
  const grandTotal = subtotal + taxAmount + surchargeAmount

  return (
    <div className="space-y-3 border-t border-zinc-800 pt-3">
      <input type="hidden" name="labor_type" value={laborType} />
      <input type="hidden" name="tax_rate_percent" value={taxRatePercent} />
      <input type="hidden" name="include_card_surcharge" value={includeSurcharge ? 'true' : 'false'} />

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">
            Labor Type {laborTypeOverride ? '(Manually Set)' : '(Auto)'}
          </label>
          <select
            value={laborType}
            onChange={e => setLaborTypeOverride(e.target.value as 'STLA' | 'NTSTLA')}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          >
            <option value="STLA">STLA - Sales Tax Labor Add-on</option>
            <option value="NTSTLA">NTSTLA - Non-Taxable Labor Add-on</option>
          </select>
          <p className="text-xs text-gray-600 mt-1">
            Auto-set from whether any Parts line is filled in ({hasParts ? 'parts present → STLA' : 'no parts → NTSTLA'}) -
            override here if this job needs the exception documented differently.
          </p>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">FL Sales Tax Rate (%)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={taxRatePercent}
            onChange={e => setTaxRatePercent(Number(e.target.value) || 0)}
            disabled={!hasParts}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
          />
          <p className="text-xs text-gray-600 mt-1">
            {hasParts
              ? 'Default 6% FL + 1% Seminole County - override for jobs in a different county.'
              : 'No parts/materials on this invoice, so no tax applies regardless of rate.'}
          </p>
        </div>
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeSurcharge}
            onChange={e => setIncludeSurcharge(e.target.checked)}
            className="rounded border-zinc-700 bg-zinc-900"
          />
          Include 3% card processing fee line
        </label>
        <p className="text-xs text-gray-600 mt-1">
          Only for credit card payments via the Square Payment Link - uncheck this (or regenerate the invoice with it
          unchecked) if the customer ends up paying by Zelle, Cash App, or debit.
        </p>
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 text-sm space-y-1">
        <div className="flex justify-between text-gray-400">
          <span>Subtotal</span>
          <span>${subtotal.toFixed(2)}</span>
        </div>
        {hasParts ? (
          <div className="flex justify-between text-gray-400">
            <span>FL Sales Tax ({taxRatePercent}%)</span>
            <span>${taxAmount.toFixed(2)}</span>
          </div>
        ) : (
          <p className="text-xs text-orange-400">Labor Only - No Parts or Materials Provided (no tax)</p>
        )}
        {includeSurcharge && (
          <div className="flex justify-between text-gray-400">
            <span>Card Processing Fee (3%)</span>
            <span>${surchargeAmount.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between font-bold text-orange-400 border-t border-zinc-800 pt-1 mt-1">
          <span>Grand Total</span>
          <span>${grandTotal.toFixed(2)}</span>
        </div>
        <p className="text-xs text-gray-600">
          Estimate only - a referral discount, if this customer qualifies, is applied server-side and isn&apos;t reflected here.
        </p>
      </div>
    </div>
  )
}

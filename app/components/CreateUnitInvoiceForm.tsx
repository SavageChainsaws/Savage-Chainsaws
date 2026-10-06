'use client'

import { useState } from 'react'
import InvoiceItemGroup, { type LineItem } from './InvoiceItemGroup'
import TaxAndSurchargeFields from './TaxAndSurchargeFields'
import { SERVICE_CALL_DESCRIPTION, SERVICE_CALL_DEFAULT_AMOUNT } from '@/lib/billing'

// Itemized counterpart to the per-unit "Create Invoice" tool's old flat
// "Labor / Service Fee $" + "Parts Total $" fields - mirrors the itemized
// line-item UX already used by the standalone CreateCustomInvoiceForm, but
// split into Parts and Labor groups (each addable/removable) plus the
// unit's Priority Fee, which stays a single field since it's a flat flag-
// driven surcharge rather than something itemized per job.
export default function CreateUnitInvoiceForm({
  unitId,
  defaultLaborPrice,
  defaultPriorityFee,
  defaultTaxRatePercent,
  defaultPartsItems,
  customerPaymentPlansEnabled,
}: {
  unitId: string
  defaultLaborPrice: number | string
  defaultPriorityFee: number | string
  defaultTaxRatePercent: number
  // Pre-fills Parts from this unit's Order Sheet (see UnitOrderSheetSection
  // in app/page.tsx) - already priced at parts_catalog retail, so this is
  // "diagnose, build the Order Sheet, buy the parts, then submit it as the
  // invoice and just add labor" in one step instead of retyping every part
  // by hand. Still fully editable before submitting.
  defaultPartsItems?: LineItem[]
  // Only this unit's customer having "Allow payment plans" turned on (Edit
  // Customer) makes the checkbox below possible to show at all - it's a
  // per-invoice decision on top of that per-customer eligibility, not a
  // replacement for it, so every other invoice stays full-price-only by
  // default even for an eligible customer.
  customerPaymentPlansEnabled?: boolean
}) {
  const [partsItems, setPartsItems] = useState<LineItem[]>(
    defaultPartsItems && defaultPartsItems.length > 0 ? defaultPartsItems : [{ description: '', price: '', quantity: '1' }]
  )
  const [laborItems, setLaborItems] = useState<LineItem[]>([
    { description: '', price: defaultLaborPrice ? String(defaultLaborPrice) : '' },
  ])
  const [priorityFee, setPriorityFee] = useState(defaultPriorityFee ? String(defaultPriorityFee) : '')

  function updateItem(
    setter: React.Dispatch<React.SetStateAction<LineItem[]>>,
    index: number,
    field: keyof LineItem,
    value: string
  ) {
    setter(prev => prev.map((it, i) => (i === index ? { ...it, [field]: value } : it)))
  }

  // prefill, when passed (see InvoiceItemGroup's quickAdd), replaces the
  // last line instead of appending a new one if that line is still
  // completely blank - clicking "+ Service Call" on a fresh invoice fills
  // the one empty Labor line already there rather than leaving it floating
  // above a second, filled-in one.
  function addItem(setter: React.Dispatch<React.SetStateAction<LineItem[]>>, prefill?: Partial<LineItem>) {
    setter(prev => {
      const last = prev[prev.length - 1]
      if (prefill && last && !last.description.trim() && !last.price.trim()) {
        return [...prev.slice(0, -1), { ...last, ...prefill }]
      }
      return [...prev, { description: '', price: '', quantity: '1', ...prefill }]
    })
  }

  function removeItem(setter: React.Dispatch<React.SetStateAction<LineItem[]>>, index: number) {
    setter(prev => prev.filter((_, i) => i !== index))
  }

  // Any Parts line with a description is enough to make the whole invoice
  // taxable, regardless of its price - the moment tangible parts/materials
  // are transferred, Fla. Admin. Code 12A-1.006 taxes the full invoice.
  const hasParts = partsItems.some(it => it.description.trim().length > 0)
  const partsTotal = partsItems.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 1), 0)
  const laborTotal = laborItems.reduce((sum, it) => sum + (Number(it.price) || 0), 0)
  const priorityFeeAmount = Number(priorityFee) || 0

  return (
    <form action="/api/invoice" method="POST" target="_blank" className="space-y-3">
      <input type="hidden" name="unit_id" value={unitId} />

      <InvoiceItemGroup
        title="Parts"
        items={partsItems}
        descriptionField="parts_description"
        priceField="parts_price"
        quantityField="parts_quantity"
        placeholder="Description, or paste a SKU (e.g. Handle bracket)"
        skuLookup
        onUpdate={(i, field, value) => updateItem(setPartsItems, i, field, value)}
        onAdd={() => addItem(setPartsItems)}
        onRemove={i => removeItem(setPartsItems, i)}
      />

      <InvoiceItemGroup
        title="Labor"
        items={laborItems}
        descriptionField="labor_description"
        priceField="labor_price"
        placeholder="Description (e.g. Tune-up)"
        quickAdd={[{
          label: `Service Call ($${SERVICE_CALL_DEFAULT_AMOUNT})`,
          description: SERVICE_CALL_DESCRIPTION,
          price: SERVICE_CALL_DEFAULT_AMOUNT.toFixed(2),
        }]}
        onUpdate={(i, field, value) => updateItem(setLaborItems, i, field, value)}
        onAdd={prefill => addItem(setLaborItems, prefill)}
        onRemove={i => removeItem(setLaborItems, i)}
      />

      <div>
        <label className="block text-xs text-gray-500 mb-1">Priority Fee $</label>
        <input
          name="priority_fee"
          type="number"
          step="0.01"
          min="0"
          value={priorityFee}
          onChange={e => setPriorityFee(e.target.value)}
          placeholder="0.00"
          title="Auto-filled from the unit's Priority flag - editable if needed."
          className="w-32 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
        />
      </div>

      <TaxAndSurchargeFields
        hasParts={hasParts}
        taxableSubtotal={partsTotal + laborTotal}
        otherCharges={priorityFeeAmount}
        defaultTaxRatePercent={defaultTaxRatePercent}
      />

      <div>
        <label className="block text-xs text-gray-500 mb-1">Notes (Optional)</label>
        <textarea
          name="notes"
          rows={2}
          placeholder="e.g. Customer aware bearings are shot on right front tire - unit still usable, but for how long is undetermined"
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
        />
        <p className="text-xs text-gray-600 mt-1">Prints on the invoice itself - a documented record of anything the customer was told.</p>
      </div>

      {customerPaymentPlansEnabled && (
        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
          <input type="checkbox" name="offer_payment_plan" value="true" className="rounded border-zinc-700 bg-zinc-900" />
          Offer a payment plan on this invoice
        </label>
      )}

      <button type="submit" className="bg-orange-600 hover:bg-orange-500 text-white text-sm px-4 py-1.5 rounded-lg">
        Create Invoice
      </button>
    </form>
  )
}

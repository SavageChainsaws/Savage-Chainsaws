'use client'

import { useState } from 'react'
import InvoiceItemGroup, { type LineItem } from './InvoiceItemGroup'
import TaxAndSurchargeFields from './TaxAndSurchargeFields'

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
}: {
  unitId: string
  defaultLaborPrice: number | string
  defaultPriorityFee: number | string
  defaultTaxRatePercent: number
}) {
  const [partsItems, setPartsItems] = useState<LineItem[]>([{ description: '', price: '' }])
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

  function addItem(setter: React.Dispatch<React.SetStateAction<LineItem[]>>) {
    setter(prev => [...prev, { description: '', price: '' }])
  }

  function removeItem(setter: React.Dispatch<React.SetStateAction<LineItem[]>>, index: number) {
    setter(prev => prev.filter((_, i) => i !== index))
  }

  // Any Parts line with a description is enough to make the whole invoice
  // taxable, regardless of its price - the moment tangible parts/materials
  // are transferred, Fla. Admin. Code 12A-1.006 taxes the full invoice.
  const hasParts = partsItems.some(it => it.description.trim().length > 0)
  const partsTotal = partsItems.reduce((sum, it) => sum + (Number(it.price) || 0), 0)
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
        placeholder="Description (e.g. Handle bracket)"
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
        onUpdate={(i, field, value) => updateItem(setLaborItems, i, field, value)}
        onAdd={() => addItem(setLaborItems)}
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

      <button type="submit" className="bg-orange-600 hover:bg-orange-500 text-white text-sm px-4 py-1.5 rounded-lg">
        Create Invoice
      </button>
    </form>
  )
}

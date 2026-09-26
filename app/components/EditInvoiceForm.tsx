'use client'

import { useState } from 'react'
import InvoiceItemGroup, { type LineItem } from './InvoiceItemGroup'
import TaxAndSurchargeFields from './TaxAndSurchargeFields'

// Edit counterpart to CreateUnitInvoiceForm - reopens an already-generated
// invoice's Parts/Labor lines for a mid-service change (customer calls
// asking for a chain added, a part removed, a price corrected) without
// creating a whole new invoice. Submits to /api/invoice/edit, which
// recomputes tax/surcharge from scratch server-side exactly like creation
// does and regenerates the PDF in place - see that route for why the
// numbers here are never trusted as final.
export default function EditInvoiceForm({
  invoiceId,
  initialPartsItems,
  initialLaborItems,
  initialPriorityFee,
  initialReferralDiscountAmount,
  taxRatePercent,
  includeCardSurcharge,
  laborType,
  onSubmit,
}: {
  invoiceId: string
  initialPartsItems: LineItem[]
  initialLaborItems: LineItem[]
  initialPriorityFee: number
  initialReferralDiscountAmount: number
  taxRatePercent: number
  includeCardSurcharge: boolean
  laborType: 'STLA' | 'NTSTLA'
  // Fired on submit (the native POST/target=_blank still proceeds - this
  // never calls preventDefault) so a caller showing this form inside a
  // modal (see EditInvoiceButton) can close itself right away instead of
  // leaving the admin looking at a form behind their newly-opened PDF tab.
  onSubmit?: () => void
}) {
  const [partsItems, setPartsItems] = useState<LineItem[]>(initialPartsItems)
  const [laborItems, setLaborItems] = useState<LineItem[]>(initialLaborItems)
  const [priorityFee, setPriorityFee] = useState(initialPriorityFee ? String(initialPriorityFee) : '')

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

  const hasParts = partsItems.some(it => it.description.trim().length > 0)
  const partsTotal = partsItems.reduce((sum, it) => sum + (Number(it.price) || 0), 0)
  const laborTotal = laborItems.reduce((sum, it) => sum + (Number(it.price) || 0), 0)
  const priorityFeeAmount = Number(priorityFee) || 0

  return (
    <form action="/api/invoice/edit" method="POST" target="_blank" onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <input type="hidden" name="referral_discount_amount" value={initialReferralDiscountAmount} />

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
          className="w-32 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
        />
      </div>

      {initialReferralDiscountAmount > 0 && (
        <p className="text-xs text-gray-500">
          Referral Discount of ${initialReferralDiscountAmount.toFixed(2)} carries over unchanged - it was a one-time
          discount already applied when this invoice was first created.
        </p>
      )}

      <TaxAndSurchargeFields
        hasParts={hasParts}
        taxableSubtotal={partsTotal + laborTotal}
        otherCharges={priorityFeeAmount - initialReferralDiscountAmount}
        defaultTaxRatePercent={taxRatePercent}
        defaultIncludeSurcharge={includeCardSurcharge}
        defaultLaborType={laborType}
      />

      <button type="submit" className="bg-orange-600 hover:bg-orange-500 text-white text-sm px-4 py-1.5 rounded-lg">
        Save Changes
      </button>
    </form>
  )
}

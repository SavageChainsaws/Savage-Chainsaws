'use client'

import { useState } from 'react'
import InvoiceItemGroup, { type LineItem } from './InvoiceItemGroup'
import TaxAndSurchargeFields from './TaxAndSurchargeFields'
import { liveTitleCase } from '@/lib/text'

type CustomerOption = { id: string; name: string; email: string | null; phone: string | null }

// Edit counterpart to CreateUnitInvoiceForm - reopens an already-generated
// invoice's Parts/Labor lines for a mid-service change (customer calls
// asking for a chain added, a part removed, a price corrected) without
// creating a whole new invoice. Submits to /api/invoice/edit, which
// recomputes tax/surcharge from scratch server-side exactly like creation
// does and regenerates the PDF in place - see that route for why the
// numbers here are never trusted as final.
export default function EditInvoiceForm({
  invoiceId,
  hasUnitId,
  customers,
  initialCustomerId,
  initialCustomerName,
  initialCustomerEmail,
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
  // Only a standalone invoice's (no unit_id) customer_name/customer_email
  // are this invoice's own editable fields - a unit-linked one's customer
  // is always derived live from the real unit/customer records instead
  // (edit those via the unit's own Edit Customer), so this form has
  // nothing of its own to offer there.
  hasUnitId: boolean
  customers: CustomerOption[]
  initialCustomerId: string | null
  initialCustomerName: string
  initialCustomerEmail: string
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
  const [customerId, setCustomerId] = useState(initialCustomerId || '')
  const [customerName, setCustomerName] = useState(initialCustomerName)
  const [customerEmail, setCustomerEmail] = useState(initialCustomerEmail)
  const [partsItems, setPartsItems] = useState<LineItem[]>(initialPartsItems)
  const [laborItems, setLaborItems] = useState<LineItem[]>(initialLaborItems)
  const [priorityFee, setPriorityFee] = useState(initialPriorityFee ? String(initialPriorityFee) : '')

  function handleSelectCustomer(id: string) {
    setCustomerId(id)
    const c = customers.find(c => c.id === id)
    if (c) {
      setCustomerName(c.name || '')
      setCustomerEmail(c.email || '')
    }
  }

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

      {hasUnitId ? (
        <p className="text-xs text-gray-500">
          Customer: <span className="text-gray-300">{initialCustomerName}</span> - linked to a tracked unit, so
          it&apos;s edited via that unit&apos;s Edit Customer instead of here.
        </p>
      ) : (
        <div className="space-y-3 border-b border-zinc-800 pb-3">
          <input type="hidden" name="customer_id" value={customerId} />
          <div>
            <label className="block text-xs text-gray-500 mb-1">Link an Existing Customer (Optional)</label>
            <select
              value={customerId}
              onChange={e => handleSelectCustomer(e.target.value)}
              className="w-full sm:w-80 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Free-form - no customer selected</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Customer Name</label>
              <input
                name="customer_name"
                value={customerName}
                onChange={e => setCustomerName(liveTitleCase(e.target.value))}
                required
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Email</label>
              <input
                name="customer_email"
                type="email"
                value={customerEmail}
                onChange={e => setCustomerEmail(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>
      )}

      <InvoiceItemGroup
        title="Parts"
        items={partsItems}
        descriptionField="parts_description"
        priceField="parts_price"
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

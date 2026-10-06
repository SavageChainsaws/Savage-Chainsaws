'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import InvoiceItemGroup, { type LineItem } from './InvoiceItemGroup'
import TaxAndSurchargeFields from './TaxAndSurchargeFields'
import { liveTitleCase } from '@/lib/text'
import { SERVICE_CALL_DESCRIPTION, SERVICE_CALL_DEFAULT_AMOUNT } from '@/lib/billing'

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
  initialNotes,
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
  initialNotes: string
  taxRatePercent: number
  includeCardSurcharge: boolean
  laborType: 'STLA' | 'NTSTLA'
  // Fired once the edit has actually saved server-side (not just on click)
  // so a caller showing this form inside a modal (see EditInvoiceButton)
  // can close itself - previously this fired the instant the native
  // form's POST was dispatched, before the page hosting this form (the
  // /invoices list or a unit's own page) had any way to know the payment
  // link had just been cleared server-side, so it kept showing the old
  // Pay Now button/link until a manual reload. Now that this submits via
  // fetch, a successful save also calls router.refresh() itself so that
  // page always reflects the fresh data as soon as the tab regains focus.
  onSubmit?: () => void
}) {
  const router = useRouter()
  const [customerId, setCustomerId] = useState(initialCustomerId || '')
  const [customerName, setCustomerName] = useState(initialCustomerName)
  const [customerEmail, setCustomerEmail] = useState(initialCustomerEmail)
  const [partsItems, setPartsItems] = useState<LineItem[]>(initialPartsItems)
  const [laborItems, setLaborItems] = useState<LineItem[]>(initialLaborItems)
  const [priorityFee, setPriorityFee] = useState(initialPriorityFee ? String(initialPriorityFee) : '')
  const [notes, setNotes] = useState(initialNotes)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  // prefill, when passed (see InvoiceItemGroup's quickAdd), replaces the
  // last line instead of appending a new one if that line is still
  // completely blank - see CreateUnitInvoiceForm.
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

  const hasParts = partsItems.some(it => it.description.trim().length > 0)
  const partsTotal = partsItems.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 1), 0)
  const laborTotal = laborItems.reduce((sum, it) => sum + (Number(it.price) || 0), 0)
  const priorityFeeAmount = Number(priorityFee) || 0

  // Fetch rather than a plain form POST, same reasoning as
  // CreateCustomInvoiceForm - lets this tell success from failure and only
  // call router.refresh()/onSubmit once the invoice has actually been
  // re-saved, rather than the instant the POST was dispatched.
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    const newTab = window.open('', '_blank')
    try {
      const res = await fetch('/api/invoice/edit', { method: 'POST', body: new FormData(e.currentTarget) })
      if (!res.ok) {
        newTab?.close()
        const body = await res.json().catch(() => ({}))
        setError(body?.error || `Could not save changes (${res.status}).`)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      if (newTab) newTab.location.href = url
      else window.open(url, '_blank')
      router.refresh()
      onSubmit?.()
    } catch {
      newTab?.close()
      setError('Could not reach the server. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
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
        minutesField
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

      <div>
        <label className="block text-xs text-gray-500 mb-1">Notes (Optional)</label>
        <textarea
          name="notes"
          rows={2}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="e.g. Customer aware bearings are shot on right front tire - unit still usable, but for how long is undetermined"
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
        />
        <p className="text-xs text-gray-600 mt-1">Prints on the invoice itself - a documented record of anything the customer was told.</p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg"
      >
        {isSubmitting ? 'Saving...' : 'Save Changes'}
      </button>
    </form>
  )
}

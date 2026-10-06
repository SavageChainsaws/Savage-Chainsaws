'use client'

import { useState } from 'react'
import { liveTitleCase } from '@/lib/text'
import { LABOR_RATE_PER_MINUTE } from '@/lib/billing'

export type LineItem = { description: string; price: string; quantity?: string; minutes?: string }

type CatalogMatch = { sku: string; description: string; cost: number; retail_price: number }

// Shared between CreateUnitInvoiceForm, CreateCustomInvoiceForm, and
// EditInvoiceForm so Parts and Labor are entered the same way everywhere -
// previously only the per-unit form had this Parts/Labor split; the
// standalone form needed it too so it can tell whether an invoice has any
// parts/materials at all (that's what drives the FL sales tax rule and the
// labor line's STLA/NTSTLA type - see lib/billing.ts).
//
// skuLookup (Parts group only) - type or paste a real STIHL SKU into the
// description field and, on blur, this looks it up against parts_catalog
// (see app/api/parts-catalog/lookup) and fills in the catalog description
// and retail price for you, same pricing source the per-unit Order Sheet
// already uses. A no-match blur (already-resolved text, a typo, a part not
// in the catalog) just leaves whatever was typed - manual entry always
// still works.
//
// quantityField (Parts group only) - a per-line Qty input alongside price,
// so e.g. 3 sleeves is one line at $1.33 x3 instead of 3 separate lines at
// the same price. price always stays a per-unit amount; the API routes
// (see app/api/invoice/route.ts) multiply by quantity to get the line's
// actual billed amount. Omitted entirely for Labor, which has no quantity
// concept - unset means 1 wherever it's read.
export default function InvoiceItemGroup({
  title,
  items,
  descriptionField,
  priceField,
  quantityField,
  placeholder,
  skuLookup,
  quickAdd,
  minutesField,
  onUpdate,
  onAdd,
  onRemove,
}: {
  title: string
  items: LineItem[]
  descriptionField: string
  priceField: string
  quantityField?: string
  placeholder: string
  skuLookup?: boolean
  // One button per entry, next to "+ Add X Line" - clicking it calls onAdd
  // with this description/price already filled in rather than blank (e.g.
  // "+ Service Call" on the Labor group - see SERVICE_CALL_DEFAULT_AMOUNT
  // in lib/billing.ts). Still a completely normal, editable line afterward.
  quickAdd?: { label: string; description: string; price: string }[]
  // Labor group only - a Min input ahead of the amount; typing minutes
  // pre-fills the line amount as minutes x LABOR_RATE_PER_MINUTE ($1.67),
  // so it's already there when tabbing over. The amount stays editable
  // afterward (e.g. the job ran longer than the clock says) and is still
  // what gets submitted as the line total - minutes themselves are never
  // submitted or stored. Applies regardless of STLA/NTSTLA - a timed labor
  // line is timed either way, parts on the invoice or not.
  minutesField?: boolean
  onUpdate: (index: number, field: keyof LineItem, value: string) => void
  // prefill, when passed, fills the new line instead of leaving it blank -
  // see quickAdd above. The plain "+ Add X Line" button below always omits
  // it.
  onAdd: (prefill?: Partial<LineItem>) => void
  onRemove: (index: number) => void
}) {
  const [lookingUp, setLookingUp] = useState<number | null>(null)

  function handleMinutesChange(i: number, value: string) {
    onUpdate(i, 'minutes', value)
    const minutes = Number(value)
    if (value.trim() && minutes > 0) {
      onUpdate(i, 'price', (Math.round(minutes * LABOR_RATE_PER_MINUTE * 100) / 100).toFixed(2))
    }
  }

  async function handleBlur(i: number, value: string) {
    if (!skuLookup) return
    const trimmed = value.trim()
    if (!trimmed) return
    setLookingUp(i)
    try {
      const res = await fetch(`/api/parts-catalog/lookup?sku=${encodeURIComponent(trimmed)}`)
      const body = await res.json().catch(() => ({}))
      const match = body?.match as CatalogMatch | null
      if (match) {
        onUpdate(i, 'description', `${match.sku} - ${match.description}`)
        onUpdate(i, 'price', String(match.retail_price))
      }
    } catch {
      // Silent - manual entry still works fine if the lookup fails.
    } finally {
      setLookingUp(null)
    }
  }

  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">
        {title}
        {skuLookup && <span className="text-gray-600 font-normal"> - paste a SKU to auto-fill price</span>}
        {quantityField && <span className="text-gray-600 font-normal"> - Qty x Price = line total</span>}
        {minutesField && (
          <span className="text-gray-600 font-normal"> - Minutes x ${LABOR_RATE_PER_MINUTE.toFixed(2)}/min = line total</span>
        )}
      </label>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input
              name={descriptionField}
              value={item.description}
              onChange={e => onUpdate(i, 'description', skuLookup ? e.target.value : liveTitleCase(e.target.value))}
              onBlur={e => handleBlur(i, e.target.value)}
              placeholder={lookingUp === i ? 'Looking up...' : placeholder}
              className="flex-1 min-w-[160px] bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
            />
            {quantityField && (
              <input
                name={quantityField}
                type="number"
                min="1"
                value={item.quantity ?? '1'}
                onChange={e => onUpdate(i, 'quantity', e.target.value)}
                title="Quantity"
                className="w-16 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm"
              />
            )}
            {minutesField && (
              <input
                type="number"
                step="1"
                min="0"
                value={item.minutes ?? ''}
                onChange={e => handleMinutesChange(i, e.target.value)}
                placeholder="Min"
                title="Minutes of labor"
                className="w-20 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm"
              />
            )}
            <input
              name={priceField}
              type="number"
              step="0.01"
              min="0"
              value={item.price}
              onChange={e => onUpdate(i, 'price', e.target.value)}
              placeholder={quantityField ? '0.00 ea' : '0.00'}
              title={quantityField ? 'Price per unit' : minutesField ? 'Line total' : undefined}
              className="w-28 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
            />
            {items.length > 1 && (
              <button type="button" onClick={() => onRemove(i)} className="text-xs text-red-400 hover:text-red-300">
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onAdd()}
          className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-orange-400 px-3 py-1.5 rounded-lg"
        >
          + Add {title.split(' ')[0]} Line
        </button>
        {quickAdd?.map(qa => (
          <button
            key={qa.label}
            type="button"
            onClick={() => onAdd({ description: qa.description, price: qa.price })}
            className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-orange-700/60 text-orange-300 px-3 py-1.5 rounded-lg"
          >
            + {qa.label}
          </button>
        ))}
      </div>
    </div>
  )
}

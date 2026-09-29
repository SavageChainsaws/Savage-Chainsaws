'use client'

import { useState } from 'react'
import { liveTitleCase } from '@/lib/text'

export type LineItem = { description: string; price: string }

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
export default function InvoiceItemGroup({
  title,
  items,
  descriptionField,
  priceField,
  placeholder,
  skuLookup,
  onUpdate,
  onAdd,
  onRemove,
}: {
  title: string
  items: LineItem[]
  descriptionField: string
  priceField: string
  placeholder: string
  skuLookup?: boolean
  onUpdate: (index: number, field: keyof LineItem, value: string) => void
  onAdd: () => void
  onRemove: (index: number) => void
}) {
  const [lookingUp, setLookingUp] = useState<number | null>(null)

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
            <input
              name={priceField}
              type="number"
              step="0.01"
              min="0"
              value={item.price}
              onChange={e => onUpdate(i, 'price', e.target.value)}
              placeholder="0.00"
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
      <button
        type="button"
        onClick={onAdd}
        className="mt-2 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-orange-400 px-3 py-1.5 rounded-lg"
      >
        + Add {title.split(' ')[0]} Line
      </button>
    </div>
  )
}

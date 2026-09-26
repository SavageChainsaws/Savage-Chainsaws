'use client'

import { liveTitleCase } from '@/lib/text'

export type LineItem = { description: string; price: string }

// Shared between CreateUnitInvoiceForm and CreateCustomInvoiceForm so
// Parts and Labor are entered the same way in both places - previously
// only the per-unit form had this Parts/Labor split; the standalone form
// needed it too so it can tell whether an invoice has any parts/materials
// at all (that's what drives the FL sales tax rule and the labor line's
// STLA/NTSTLA type - see lib/billing.ts).
export default function InvoiceItemGroup({
  title,
  items,
  descriptionField,
  priceField,
  placeholder,
  onUpdate,
  onAdd,
  onRemove,
}: {
  title: string
  items: LineItem[]
  descriptionField: string
  priceField: string
  placeholder: string
  onUpdate: (index: number, field: keyof LineItem, value: string) => void
  onAdd: () => void
  onRemove: (index: number) => void
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{title}</label>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input
              name={descriptionField}
              value={item.description}
              onChange={e => onUpdate(i, 'description', liveTitleCase(e.target.value))}
              placeholder={placeholder}
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

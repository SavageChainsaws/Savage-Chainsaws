'use client'

import { useState } from 'react'

type LineItem = { description: string; price: string }

function ItemGroup({
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
              onChange={e => onUpdate(i, 'description', e.target.value)}
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
}: {
  unitId: string
  defaultLaborPrice: number | string
  defaultPriorityFee: number | string
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

  const total =
    partsItems.reduce((sum, it) => sum + (Number(it.price) || 0), 0) +
    laborItems.reduce((sum, it) => sum + (Number(it.price) || 0), 0) +
    (Number(priorityFee) || 0)

  return (
    <form action="/api/invoice" method="POST" target="_blank" className="space-y-3">
      <input type="hidden" name="unit_id" value={unitId} />

      <ItemGroup
        title="Parts"
        items={partsItems}
        descriptionField="parts_description"
        priceField="parts_price"
        placeholder="Description (e.g. Handle bracket)"
        onUpdate={(i, field, value) => updateItem(setPartsItems, i, field, value)}
        onAdd={() => addItem(setPartsItems)}
        onRemove={i => removeItem(setPartsItems, i)}
      />

      <ItemGroup
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

      <div className="flex items-center justify-between border-t border-zinc-800 pt-3">
        <span className="text-sm text-gray-400">Grand Total</span>
        <span className="text-lg font-bold text-orange-400">${total.toFixed(2)}</span>
      </div>

      <button type="submit" className="bg-orange-600 hover:bg-orange-500 text-white text-sm px-4 py-1.5 rounded-lg">
        Create Invoice
      </button>
    </form>
  )
}

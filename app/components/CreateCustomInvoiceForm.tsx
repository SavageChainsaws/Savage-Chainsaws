'use client'

import { useState } from 'react'

type CustomerOption = {
  id: string
  name: string
  email: string | null
  phone: string | null
}

type LineItem = { description: string; price: string }

export default function CreateCustomInvoiceForm({ customers }: { customers: CustomerOption[] }) {
  const [selectedId, setSelectedId] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [items, setItems] = useState<LineItem[]>([
    { description: '', price: '' },
    { description: '', price: '' },
  ])

  function handleSelectCustomer(id: string) {
    setSelectedId(id)
    const c = customers.find(c => c.id === id)
    if (c) {
      setName(c.name || '')
      setEmail(c.email || '')
      setPhone(c.phone || '')
    }
  }

  function updateItem(index: number, field: keyof LineItem, value: string) {
    setItems(prev => prev.map((it, i) => (i === index ? { ...it, [field]: value } : it)))
  }

  function addItem() {
    setItems(prev => [...prev, { description: '', price: '' }])
  }

  function removeItem(index: number) {
    setItems(prev => prev.filter((_, i) => i !== index))
  }

  const total = items.reduce((sum, it) => sum + (Number(it.price) || 0), 0)

  return (
    <form action="/api/invoice/custom" method="POST" target="_blank" className="space-y-3">
      <div>
        <label className="block text-xs text-gray-500 mb-1">Link an existing customer (optional)</label>
        <select
          value={selectedId}
          onChange={e => handleSelectCustomer(e.target.value)}
          className="w-full sm:w-80 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">Free-form - no customer selected</option>
          {customers.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <p className="text-xs text-gray-600 mt-1">
          Selecting a customer auto-fills the fields below - everything stays editable after that.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Customer Name</label>
          <input
            name="customer_name"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Email</label>
          <input
            name="customer_email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Phone</label>
          <input
            name="customer_phone"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      <details className="group/unit-fields">
        <summary className="text-xs text-orange-400 cursor-pointer list-none select-none">
          Unit info (optional) <span className="text-gray-600">- if this invoice relates to a piece of equipment</span>
        </summary>
        <div className="grid sm:grid-cols-3 gap-3 mt-2">
          <input name="unit_model" placeholder="Model" className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
          <input name="unit_serial" placeholder="Serial Number" className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
          <input name="unit_equipment_type" placeholder="Equipment Type" className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
        </div>
      </details>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Line Items</label>
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input
                name="description"
                value={item.description}
                onChange={e => updateItem(i, 'description', e.target.value)}
                placeholder="Description (e.g. Labor, Blade, Air Filter...)"
                className="flex-1 min-w-[160px] bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
              />
              <input
                name="price"
                type="number"
                step="0.01"
                min="0"
                value={item.price}
                onChange={e => updateItem(i, 'price', e.target.value)}
                placeholder="0.00"
                className="w-28 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
              />
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeItem(i)}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addItem}
          className="mt-2 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-orange-400 px-3 py-1.5 rounded-lg"
        >
          + Add Line
        </button>
      </div>

      <div className="flex items-center justify-between border-t border-zinc-800 pt-3">
        <span className="text-sm text-gray-400">Grand Total</span>
        <span className="text-lg font-bold text-orange-400">${total.toFixed(2)}</span>
      </div>

      <button type="submit" className="bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-5 py-2 rounded-lg">
        Generate PDF Invoice
      </button>
    </form>
  )
}

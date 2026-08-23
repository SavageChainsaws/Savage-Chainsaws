'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type InventoryItem = {
  id: string
  model: string | null
  equipment_type: string | null
  description: string | null
  quantity: number | null
  price: number | null
  photo_url: string | null
  active: boolean | null
}

const UNIT_TYPES = [
  'Chainsaw',
  'Pole Saw',
  'String Trimmer',
  'Hedge Trimmer',
  'Blower',
  'Backpack Blower',
  'Riding Mower',
  'Walk-Behind Mower',
  'Edger',
  'Cutquik',
  'Other',
]

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const [model, setModel] = useState('')
  const [equipmentType, setEquipmentType] = useState('Chainsaw')
  const [description, setDescription] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [price, setPrice] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('inventory')
      .select('*')
      .order('model')
    setItems(data || [])
    setLoading(false)
  }

  async function uploadFile(file: File) {
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const fileName = `inv-${Date.now()}-${safe}`
    const { error } = await supabase.storage
      .from('invoices')
      .upload(fileName, file, {
        contentType: file.type || 'image/jpeg',
        upsert: false,
      })
    if (error) throw error
    const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(fileName)
    return publicUrl
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault()
    if (!model.trim()) return
    setBusy(true)
    setMessage(null)
    try {
      let photoUrl: string | null = null
      if (photoFile) photoUrl = await uploadFile(photoFile)
      const { error } = await supabase.from('inventory').insert({
        model: model.trim(),
        equipment_type: equipmentType || null,
        description: description.trim() || null,
        quantity: parseInt(quantity) || 1,
        price: price ? parseFloat(price) : null,
        photo_url: photoUrl,
        active: true,
      })
      if (error) throw error
      setModel('')
      setEquipmentType('Chainsaw')
      setDescription('')
      setQuantity('1')
      setPrice('')
      setPhotoFile(null)
      setShowAdd(false)
      setMessage('Item added to inventory.')
      await load()
    } catch (err) {
      console.error(err)
      setMessage('Could not add item.')
    }
    setBusy(false)
  }

  async function toggleActive(id: string, current: boolean | null) {
    const { error } = await supabase
      .from('inventory')
      .update({ active: !current })
      .eq('id', id)
    if (error) {
      setMessage('Could not update item.')
      return
    }
    await load()
  }

  async function deleteItem(id: string) {
    if (!confirm('Remove this item from inventory?')) return
    const { error } = await supabase.from('inventory').delete().eq('id', id)
    if (error) {
      setMessage('Could not delete item.')
      return
    }
    setMessage('Item removed.')
    await load()
  }

  const active = items.filter(i => i.active !== false)
  const inactive = items.filter(i => i.active === false)

  return (
    <main className="min-h-screen bg-zinc-950 text-white p-4 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/images/logo.png" alt="" className="h-10 w-10 object-contain" />
            <div>
              <h1 className="text-xl font-bold">
                SAVAGE <span className="text-orange-500">CHAINSAWS</span>
              </h1>
              <p className="text-xs text-gray-500">Inventory — upgrades & replacements</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowAdd(!showAdd)}
              className="bg-orange-600 hover:bg-orange-500 text-sm font-medium px-4 py-2 rounded-lg"
            >
              {showAdd ? 'Close' : 'Add Item'}
            </button>
            <Link
              href="/"
              className="border border-zinc-700 text-sm px-3 py-2 rounded-lg hover:bg-zinc-800"
            >
              Admin
            </Link>
            <Link
              href="/customer"
              className="border border-zinc-700 text-sm px-3 py-2 rounded-lg hover:bg-zinc-800"
            >
              Portal
            </Link>
          </div>
        </div>

        {message && (
          <div className="bg-zinc-900 border border-orange-500/40 rounded-xl px-4 py-3 text-sm text-orange-300">
            {message}
          </div>
        )}

        {showAdd && (
          <form
            onSubmit={addItem}
            className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-6 grid sm:grid-cols-2 gap-4"
          >
            <h2 className="sm:col-span-2 font-semibold text-orange-400">Add inventory item</h2>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Model *</label>
              <input
                required
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder="e.g. MS 462"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type</label>
              <select
                value={equipmentType}
                onChange={e => setEquipmentType(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
              >
                {UNIT_TYPES.map(t => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Quantity</label>
              <input
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                type="number"
                min="0"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Price (optional)</label>
              <input
                value={price}
                onChange={e => setPrice(e.target.value)}
                type="number"
                step="0.01"
                placeholder="0.00"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Description</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={2}
                placeholder="Notes for upgrade / replacement options"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Photo (optional)</label>
              <input
                type="file"
                accept="image/*"
                onChange={e => setPhotoFile(e.target.files?.[0] || null)}
                className="w-full text-sm text-gray-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-orange-600 file:text-white"
              />
            </div>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={busy}
                className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-lg"
              >
                {busy ? 'Saving...' : 'Save Item'}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <p className="text-gray-500 text-sm">Loading...</p>
        ) : (
          <>
            <div>
              <h2 className="text-lg font-semibold text-orange-400 mb-3">
                Available ({active.length})
              </h2>
              {active.length === 0 ? (
                <p className="text-gray-500 text-sm">No active inventory items yet.</p>
              ) : (
                <div className="space-y-3">
                  {active.map(item => (
                    <div
                      key={item.id}
                      className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex gap-4"
                    >
                      {item.photo_url ? (
                        <img
                          src={item.photo_url}
                          alt=""
                          className="h-16 w-16 object-cover rounded-lg border border-zinc-700 shrink-0"
                        />
                      ) : (
                        <div className="h-16 w-16 rounded-lg border border-zinc-700 bg-zinc-800 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold">
                          {item.model}
                          {item.equipment_type ? ` · ${item.equipment_type}` : ''}
                        </p>
                        <p className="text-sm text-gray-400">
                          Qty: {item.quantity ?? 0}
                          {item.price != null ? ` · $${Number(item.price).toFixed(2)}` : ''}
                        </p>
                        {item.description && (
                          <p className="text-sm text-gray-500 mt-1">{item.description}</p>
                        )}
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => toggleActive(item.id, item.active)}
                            className="text-xs border border-zinc-600 px-2 py-1 rounded hover:border-orange-500"
                          >
                            Mark inactive
                          </button>
                          <button
                            onClick={() => deleteItem(item.id)}
                            className="text-xs text-red-400 hover:text-red-300"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {inactive.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer list-none flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
                  <h2 className="text-lg font-semibold text-gray-400">
                    Inactive ({inactive.length})
                  </h2>
                  <span className="text-gray-500 text-sm group-open:rotate-180 transition">▼</span>
                </summary>
                <div className="mt-3 space-y-3">
                  {inactive.map(item => (
                    <div
                      key={item.id}
                      className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 flex gap-4 opacity-70"
                    >
                      <div className="flex-1">
                        <p className="font-medium">
                          {item.model}
                          {item.equipment_type ? ` · ${item.equipment_type}` : ''}
                        </p>
                        <button
                          onClick={() => toggleActive(item.id, item.active)}
                          className="text-xs text-orange-400 mt-2"
                        >
                          Reactivate
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </main>
  )
}
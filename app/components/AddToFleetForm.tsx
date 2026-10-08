'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { liveTitleCase, toTitleCase } from '@/lib/text'
import { STIHL_PREFIX_MAP, EQUIPMENT_CATEGORIES, isIdentifyingSerial, escapeLikePattern } from '@/lib/units'

const supabase = createClient()

// Registers equipment a customer already owns, outside of a service
// check-in - same serial/customer dedup as Check In (see CheckInForm), so
// a unit already checked in or already on the fleet gets its fleet details
// filled in on the existing record instead of a second, duplicate row.
export default function AddToFleetForm({
  customerId,
  onAdded,
  onMessage,
}: {
  customerId: string
  onAdded: () => void | Promise<void>
  onMessage: (message: string | null) => void
}) {
  const [fleetSerial, setFleetSerial] = useState('')
  const [fleetModel, setFleetModel] = useState('')
  const [fleetType, setFleetType] = useState('')
  const [fleetCustomType, setFleetCustomType] = useState('')
  const [fleetTypeManuallySet, setFleetTypeManuallySet] = useState(false)
  const [fleetNickname, setFleetNickname] = useState('')
  const [fleetHours, setFleetHours] = useState('')
  const [fleetThumb, setFleetThumb] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function handleFleetModelChange(value: string) {
    const upper = value.toUpperCase()
    setFleetModel(upper)
    if (fleetTypeManuallySet) return
    const prefix = upper.trim().slice(0, 2)
    setFleetType(STIHL_PREFIX_MAP[prefix] || (upper.trim() ? 'Other' : ''))
  }

  function handleFleetTypeChange(value: string) {
    setFleetTypeManuallySet(true)
    setFleetType(value)
  }

  async function uploadFile(file: File, prefix: string) {
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const fileName = `${prefix}-${Date.now()}-${safe}`
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

  async function handleAddFleet(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    onMessage(null)
    try {
      let thumbUrl: string | null = null
      if (fleetThumb) thumbUrl = await uploadFile(fleetThumb, `fleet-${customerId}`)
      const finalFleetType = fleetType === 'Other' && fleetCustomType.trim() ? fleetCustomType.trim() : fleetType
      // Matches how the admin side already handles an unknown serial -
      // "Unknown" is on the non-identifying placeholder list, so dedup
      // matching below correctly never treats two "Unknown" units as the
      // same physical unit.
      const trimmedFleetSerial = fleetSerial.trim() || 'Unknown'
      const historyLine = `${new Date().toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })} - Added to fleet by customer`

      // Same serial/customer dedup as check-in - a unit already checked in
      // for service (or already on the fleet) gets its fleet details filled
      // in on the existing record instead of a second, duplicate row.
      // Status is left untouched so this never pulls an in-progress repair
      // back to 'Fleet'. Skipped for placeholder serials ("Unknown", "N/A",
      // ...) since those aren't unique to one physical unit.
      let existingFleetUnit: { id: string; history: string | null } | null = null
      if (isIdentifyingSerial(trimmedFleetSerial)) {
        const { data: existingMatches } = await supabase
          .from('units')
          .select('id, history')
          .eq('customer_id', customerId)
          .ilike('serial_number', escapeLikePattern(trimmedFleetSerial))
          .order('created_at', { ascending: false })
          .limit(1)
        existingFleetUnit = existingMatches?.[0] || null
      }

      const fleetFields = {
        serial_number: trimmedFleetSerial,
        model: fleetModel.trim() || null,
        equipment_type: finalFleetType || null,
        nickname: fleetNickname.trim() ? toTitleCase(fleetNickname) : null,
        hour_meter: fleetType === 'Riding Lawn Mower' ? (fleetHours.trim() || null) : null,
      }

      const { error } = existingFleetUnit
        ? await supabase
            .from('units')
            .update({
              ...fleetFields,
              ...(thumbUrl ? { thumbnail_url: thumbUrl } : {}),
              archived: false,
              history: existingFleetUnit.history ? `${historyLine}\n${existingFleetUnit.history}` : historyLine,
            })
            .eq('id', existingFleetUnit.id)
        : await supabase.from('units').insert({
            ...fleetFields,
            thumbnail_url: thumbUrl,
            customer_id: customerId,
            status: 'Fleet',
            decision_seen: true,
            archived: false,
            history: historyLine,
          })
      if (error) {
        console.error(error)
        onMessage('Could not add unit to fleet.')
        setSubmitting(false)
        return
      }
      setFleetSerial('')
      setFleetModel('')
      setFleetType('')
      setFleetCustomType('')
      setFleetTypeManuallySet(false)
      setFleetNickname('')
      setFleetHours('')
      setFleetThumb(null)
      onMessage('Unit added to your fleet.')
      await onAdded()
    } catch (err) {
      console.error(err)
      onMessage('Could not add unit to fleet.')
    }
    setSubmitting(false)
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5">
      <h2 className="text-lg font-semibold text-orange-400 mb-1">Add Unit to Fleet</h2>
      <p className="text-sm text-gray-500 mb-4">
        Register equipment you own so you can schedule service later.
      </p>
      <form onSubmit={handleAddFleet} className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Model</label>
          <input
            value={fleetModel}
            onChange={e => handleFleetModelChange(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
            placeholder="e.g. MS 462"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Serial Number (optional)</label>
          <input
            value={fleetSerial}
            onChange={e => setFleetSerial(e.target.value)}
            placeholder="Leave blank if unknown"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Unit Type</label>
          <select
            value={fleetType}
            onChange={e => handleFleetTypeChange(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Select equipment type</option>
            {EQUIPMENT_CATEGORIES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {fleetType === 'Other' && (
            <input
              value={fleetCustomType}
              onChange={e => setFleetCustomType(e.target.value)}
              placeholder="Describe equipment type (e.g. battery unit)"
              className="mt-2 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
            />
          )}
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Nickname (optional)</label>
          <input
            value={fleetNickname}
            onChange={e => setFleetNickname(liveTitleCase(e.target.value))}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
            placeholder="e.g. Shop mower #2"
          />
        </div>
        {fleetType === 'Riding Lawn Mower' && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Hour meter (optional)</label>
            <input
              value={fleetHours}
              onChange={e => setFleetHours(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
              placeholder="e.g. 142.5"
              inputMode="decimal"
            />
          </div>
        )}
        <div>
          <label className="block text-xs text-gray-500 mb-1">Thumbnail photo (optional)</label>
          <input
            type="file"
            accept="image/*"
            onChange={e => setFleetThumb(e.target.files?.[0] || null)}
            className="w-full text-sm text-gray-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-orange-600 file:text-white"
          />
        </div>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={submitting}
            className="bg-orange-600 hover:bg-orange-500 disabled:opacity-60 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition"
          >
            {submitting ? 'Adding...' : 'Add to Fleet'}
          </button>
        </div>
      </form>
    </div>
  )
}

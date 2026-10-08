'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { STIHL_PREFIX_MAP, EQUIPMENT_CATEGORIES, isIdentifyingSerial, escapeLikePattern } from '@/lib/units'
import { notifyAdminPush } from '@/lib/notifyAdminPush'

const supabase = createClient()

// Lets a customer check a unit in for service themselves, outside of a
// drop-off. Same serial/customer dedup as Add to Fleet (see
// AddToFleetForm) - a unit already on this customer's fleet (same serial)
// gets linked and its status updated instead of creating a second,
// duplicate row.
export default function CustomerCheckInForm({
  customerId,
  onCheckedIn,
  onMessage,
}: {
  customerId: string
  onCheckedIn: () => void | Promise<void>
  onMessage: (message: string | null) => void
}) {
  const [serial, setSerial] = useState('')
  const [model, setModel] = useState('')
  const [unitType, setUnitType] = useState('')
  const [customUnitType, setCustomUnitType] = useState('')
  const [unitTypeManuallySet, setUnitTypeManuallySet] = useState(false)
  const [hours, setHours] = useState('')
  const [problem, setProblem] = useState('')
  const [scheduled, setScheduled] = useState('')
  const [notes, setNotes] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function handleModelChange(value: string) {
    const upper = value.toUpperCase()
    setModel(upper)
    if (unitTypeManuallySet) return
    const prefix = upper.trim().slice(0, 2)
    setUnitType(STIHL_PREFIX_MAP[prefix] || (upper.trim() ? 'Other' : ''))
  }

  function handleUnitTypeChange(value: string) {
    setUnitTypeManuallySet(true)
    setUnitType(value)
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

  async function handleCheckIn(e: React.FormEvent) {
    e.preventDefault()
    if (!serial.trim()) return
    setSubmitting(true)
    onMessage(null)
    try {
      let photoUrl: string | null = null
      if (photoFile) photoUrl = await uploadFile(photoFile, customerId)
      const createdAt = scheduled
        ? new Date(scheduled).toISOString()
        : new Date().toISOString()
      const finalUnitType = unitType === 'Other' && customUnitType.trim() ? customUnitType.trim() : unitType
      const trimmedSerial = serial.trim()

      // A unit already on this customer's fleet (same serial) gets linked
      // and its status updated instead of creating a second, duplicate row.
      // Skipped for placeholder serials ("Unknown", "N/A", ...) since those
      // aren't unique to one physical unit.
      let existingUnit: { id: string } | null = null
      if (isIdentifyingSerial(trimmedSerial)) {
        const { data: existingMatches } = await supabase
          .from('units')
          .select('id')
          .eq('customer_id', customerId)
          .ilike('serial_number', escapeLikePattern(trimmedSerial))
          .order('created_at', { ascending: false })
          .limit(1)
        existingUnit = existingMatches?.[0] || null
      }

      const checkInFields = {
        serial_number: trimmedSerial,
        model: model.trim() || null,
        equipment_type: finalUnitType || null,
        hour_meter: unitType === 'Riding Lawn Mower' ? (hours.trim() || null) : null,
        problem_type: problem.trim() || null,
        notes: notes.trim() || null,
        notes_updated_at: new Date().toISOString(),
        status: 'Repair Requested',
        status_since: createdAt,
        decision_seen: true,
        archived: false,
        created_at: createdAt,
      }

      const { data: mutatedUnit, error } = existingUnit
        ? await supabase
            .from('units')
            .update({
              ...checkInFields,
              ...(photoUrl ? { photo_url: photoUrl, thumbnail_url: photoUrl } : {}),
            })
            .eq('id', existingUnit.id)
            .select('id')
            .single()
        : await supabase
            .from('units')
            .insert({
              ...checkInFields,
              photo_url: photoUrl,
              thumbnail_url: photoUrl,
              customer_id: customerId,
            })
            .select('id')
            .single()
      if (error) {
        console.error(error)
        onMessage('Could not check in this unit. Let Jesse know if this keeps happening.')
        setSubmitting(false)
        return
      }
      notifyAdminPush('service_request', mutatedUnit.id)
      setSerial('')
      setModel('')
      setUnitType('')
      setCustomUnitType('')
      setUnitTypeManuallySet(false)
      setHours('')
      setProblem('')
      setScheduled('')
      setNotes('')
      setPhotoFile(null)
      onMessage('Unit checked in. Jesse will see it shortly.')
      await onCheckedIn()
    } catch (err) {
      console.error(err)
      onMessage('Could not check in this unit. Let Jesse know if this keeps happening.')
    }
    setSubmitting(false)
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5">
      <h2 className="text-lg font-semibold text-orange-400 mb-1">Check In a Unit</h2>
      <p className="text-sm text-gray-500 mb-4">
        Tell us what&apos;s coming in. Jesse can correct any details after pickup.
      </p>
      <form onSubmit={handleCheckIn} className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Model</label>
          <input
            value={model}
            onChange={e => handleModelChange(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
            placeholder="e.g. MS 462"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Serial Number *</label>
          <input
            required
            value={serial}
            onChange={e => setSerial(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Unit Type</label>
          <select
            value={unitType}
            onChange={e => handleUnitTypeChange(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Select equipment type</option>
            {EQUIPMENT_CATEGORIES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {unitType === 'Other' && (
            <input
              value={customUnitType}
              onChange={e => setCustomUnitType(e.target.value)}
              placeholder="Describe equipment type (e.g. battery unit)"
              className="mt-2 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
            />
          )}
        </div>
        {unitType === 'Riding Lawn Mower' && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Hour meter (optional)</label>
            <input
              value={hours}
              onChange={e => setHours(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
              placeholder="e.g. 142.5"
              inputMode="decimal"
            />
          </div>
        )}
        <div>
          <label className="block text-xs text-gray-500 mb-1">What&apos;s wrong</label>
          <input
            value={problem}
            onChange={e => setProblem(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
            placeholder="Won't start, tune-up, etc."
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Scheduled drop-off (optional)</label>
          <input
            type="datetime-local"
            value={scheduled}
            onChange={e => setScheduled(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Photo of unit / serial plate</label>
          <input
            type="file"
            accept="image/*"
            onChange={e => setPhotoFile(e.target.files?.[0] || null)}
            className="w-full text-sm text-gray-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-orange-600 file:text-white"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
            placeholder="Anything else we should know..."
          />
        </div>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={submitting}
            className="bg-orange-600 hover:bg-orange-500 disabled:opacity-60 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition"
          >
            {submitting ? 'Checking in...' : 'Check In Unit'}
          </button>
        </div>
      </form>
    </div>
  )
}

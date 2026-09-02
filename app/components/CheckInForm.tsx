'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resizeImage } from '@/lib/resizeImage'

const supabase = createClient()

const STIHL_PREFIX_MAP: Record<string, string> = {
  FC: 'Edger',
  FS: 'String Trimmer',
  MS: 'Chainsaw',
  HL: 'Hedge Trimmer',
  HT: 'Pole Saw',
  TS: 'Cut Quik Saw',
  KM: 'Kombi Unit',
  HS: 'Handheld Hedge Trimmer',
  BR: 'Backpack Blower',
  BG: 'Handheld Blower',
  RB: 'Pressure Washer',
  RZ: 'Riding Lawn Mower',
  SR: 'Backpack Sprayer',
}

const EQUIPMENT_CATEGORIES = [
  'Chainsaw',
  'Pole Saw',
  'String Trimmer',
  'Hedge Trimmer',
  'Handheld Hedge Trimmer',
  'Edger',
  'Cut Quik Saw',
  'Kombi Unit',
  'Backpack Blower',
  'Handheld Blower',
  'Pressure Washer',
  'Riding Lawn Mower',
  'Backpack Sprayer',
  'Other',
]

export default function CheckInForm({
  customerId,
  addUnitAction,
}: {
  customerId: string
  addUnitAction: (formData: FormData) => Promise<void>
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const [model, setModel] = useState('')
  const [equipmentType, setEquipmentType] = useState('')
  const [customType, setCustomType] = useState('')
  const [typeManuallySet, setTypeManuallySet] = useState(false)

  function handleModelChange(value: string) {
    const upper = value.toUpperCase()
    setModel(upper)
    if (typeManuallySet) return
    const prefix = upper.trim().slice(0, 2)
    setEquipmentType(STIHL_PREFIX_MAP[prefix] || (upper.trim() ? 'Other' : ''))
  }

  function handleTypeChange(value: string) {
    setTypeManuallySet(true)
    setEquipmentType(value)
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError(null)
    setPhotoUrl(null)
    setSuccess(false)

    try {
      const resized = await resizeImage(file, 1200)
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'jpg'
      const fileName = `checkin-${Date.now()}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('invoices')
        .upload(fileName, resized, {
          contentType: 'image/jpeg',
          upsert: false,
        })

      if (uploadError) {
        setError('Photo upload failed. You can still check in without a photo.')
        setUploading(false)
        return
      }

      const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(fileName)
      setPhotoUrl(publicUrl)
    } catch {
      setError('Photo upload failed. You can still check in without a photo.')
    }

    setUploading(false)
  }

  async function handleSubmit(formData: FormData) {
    setSubmitting(true)
    setError(null)
    setSuccess(false)

    if (photoUrl) {
      formData.set('photo_url', photoUrl)
    }
    formData.delete('photo')

    const finalType = equipmentType === 'Other' && customType.trim() ? customType.trim() : equipmentType
    formData.set('equipment_type', finalType)

    try {
      await addUnitAction(formData)
      setPhotoUrl(null)
      setModel('')
      setEquipmentType('')
      setCustomType('')
      setTypeManuallySet(false)
      setSuccess(true)
      formRef.current?.reset()
      router.refresh()
    } catch {
      setError('Check-in failed. Try again.')
    }

    setSubmitting(false)
  }

  return (
    <form ref={formRef} action={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      <input type="hidden" name="customer_id" value={customerId} />

      <div>
        <label className="block text-xs text-gray-500 mb-1">Model</label>
        <input
          name="model"
          value={model}
          onChange={e => handleModelChange(e.target.value)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
          placeholder="e.g. MS 462"
        />
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Serial Number *</label>
        <input name="serial" required className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" placeholder="Serial number" />
        <p className="text-xs text-gray-600 mt-1">
          Plate worn or unreadable? Enter a custom ID instead (e.g. BR800CE-1) - it&apos;s tracked the same as a real serial.
        </p>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">
          Equipment Type
          {typeManuallySet ? null : equipmentType && equipmentType !== 'Other' ? (
            <span className="text-orange-400 normal-case"> (auto-detected from model)</span>
          ) : null}
        </label>
        <select
          name="equipment_type"
          value={equipmentType}
          onChange={e => handleTypeChange(e.target.value)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
        >
          <option value="">Select equipment type</option>
          {EQUIPMENT_CATEGORIES.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
        {equipmentType === 'Other' && (
          <input
            value={customType}
            onChange={e => setCustomType(e.target.value)}
            placeholder="Describe equipment type (e.g. battery unit)"
            className="mt-2 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
          />
        )}
      </div>

      {equipmentType === 'Riding Lawn Mower' && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Hour Meter (optional)</label>
          <input name="hour_meter" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" placeholder="e.g. 142.5" />
        </div>
      )}

      <div>
        <label className="block text-xs text-gray-500 mb-1">Part Number (optional)</label>
        <input name="part_number" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" placeholder="OEM / part #" />
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Check-in Date</label>
        <input type="datetime-local" name="check_in_date" defaultValue={new Date().toISOString().slice(0, 16)} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" />
      </div>

      <div className="flex items-end gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer pb-2">
          <input type="checkbox" name="is_priority" value="true" className="rounded border-zinc-600 bg-zinc-800 text-orange-500 focus:ring-orange-500" />
          <span className="text-orange-400 font-medium">Priority / Expedite</span>
        </label>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Expedite Fee (optional)</label>
        <input name="expedite_fee" type="number" step="0.01" min="0" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" placeholder="e.g. 75.00" />
      </div>

      <div className="md:col-span-2 lg:col-span-3">
        <label className="block text-xs text-gray-500 mb-1">Photo of Unit / Serial Plate</label>
        <input
          type="file"
          accept="image/*"
          onChange={handlePhotoChange}
          className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-orange-600 file:text-white hover:file:bg-orange-500"
        />
        <p className="text-xs text-gray-500 mt-1">
          {uploading ? 'Uploading photo...' : photoUrl ? 'Photo ready' : 'Take photo or choose from library'}
        </p>
        {photoUrl && (
          <img src={photoUrl} alt="Preview" className="mt-2 h-24 w-24 object-cover rounded-lg border border-zinc-700" />
        )}
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
        {success && <p className="text-xs text-green-400 mt-1">Unit checked in</p>}
      </div>

      <div className="md:col-span-2 lg:col-span-3">
        <label className="block text-xs text-gray-500 mb-1">Customer Notes (optional)</label>
        <textarea name="customer_notes" rows={2} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" placeholder="What the customer said is wrong..." />
      </div>

      <div className="md:col-span-2 lg:col-span-3">
        <button
          type="submit"
          disabled={uploading || submitting}
          className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-medium px-6 py-2.5 rounded-lg transition"
        >
          {submitting ? 'Checking in...' : uploading ? 'Uploading...' : 'Check In Unit'}
        </button>
      </div>
    </form>
  )
}

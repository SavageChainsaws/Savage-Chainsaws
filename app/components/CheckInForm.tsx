'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

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

    try {
      await addUnitAction(formData)
      setPhotoUrl(null)
      setSuccess(true)
      formRef.current?.reset()
      router.refresh()
    } catch {
      setError('Check-in failed. Try again.')
    }

    setSubmitting(false)
  }

  return (
    <form ref={formRef} action={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <input type="hidden" name="customer_id" value={customerId} />

      <div>
        <label className="block text-xs text-gray-500 mb-1">Model</label>
        <input name="model" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" placeholder="e.g. MS 462" />
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Serial Number *</label>
        <input name="serial" required className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" placeholder="Serial number" />
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Equipment Type</label>
        <select name="equipment_type" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500">
          <option value="Chainsaw">Chainsaw</option>
          <option value="Pole Saw">Pole Saw</option>
          <option value="Blower">Blower</option>
          <option value="Trimmer">Trimmer</option>
          <option value="Lawnmower">Lawnmower</option>
          <option value="Hedge Trimmer">Hedge Trimmer</option>
          <option value="Other">Other</option>
        </select>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Problem Type</label>
        <input name="problem_type" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" placeholder="Won't start, loss of power, etc." />
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Hour Meter (optional)</label>
        <input name="hour_meter" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" placeholder="e.g. 142.5" />
      </div>

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
          {uploading ? 'Uploading photoâ€¦' : photoUrl ? 'âœ“ Photo ready' : 'Take photo or choose from library'}
        </p>
        {photoUrl && (
          <img src={photoUrl} alt="Preview" className="mt-2 h-24 w-24 object-cover rounded-lg border border-zinc-700" />
        )}
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
        {success && <p className="text-xs text-green-400 mt-1">âœ“ Unit checked in</p>}
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
          {submitting ? 'Checking inâ€¦' : uploading ? 'Uploadingâ€¦' : 'Check In Unit'}
        </button>
      </div>
    </form>
  )
}

async function resizeImage(file: File, maxWidth: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas not supported'))
        return
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob)
          else reject(new Error('Resize failed'))
        },
        'image/jpeg',
        0.75
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Image load failed'))
    }
    img.src = url
  })
}

'use client'

import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function CheckInForm({
  customerId,
  addUnitAction,
}: {
  customerId: string
  addUnitAction: (formData: FormData) => Promise<void>
}) {
  const [uploading, setUploading] = useState(false)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError(null)
    setPhotoUrl(null)

    try {
      // Resize large phone photos before upload
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
    if (photoUrl) {
      formData.set('photo_url', photoUrl)
    }
    formData.delete('photo')
    await addUnitAction(formData)
  }

  return (
    <form action={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <input type="hidden" name="customer_id" value={customerId} />
      <div>
        <label className="block text-xs text-gray-500 mb-1">Serial Number *</label>
        <input name="serial" required className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" placeholder="Serial number" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Model</label>
        <input name="model" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" placeholder="e.g. MS 462" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Problem Type</label>
        <input name="problem_type" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" placeholder="Won't start, loss of power, etc." />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Check-in Date</label>
        <input type="datetime-local" name="check_in_date" defaultValue={new Date().toISOString().slice(0, 16)} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" />
      </div>
      <div className="md:col-span-2">
        <label className="block text-xs text-gray-500 mb-1">Photo of Unit / Serial Plate</label>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handlePhotoChange}
          className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-orange-600 file:text-white hover:file:bg-orange-500"
        />
        <p className="text-xs text-gray-500 mt-1">
          {uploading ? 'Uploading photo…' : photoUrl ? '✓ Photo ready' : 'On phone this opens the camera'}
        </p>
        {photoUrl && (
          <img src={photoUrl} alt="Preview" className="mt-2 h-24 w-24 object-cover rounded-lg border border-zinc-700" />
        )}
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </div>
      <div className="md:col-span-2">
        <label className="block text-xs text-gray-500 mb-1">Customer Notes (optional)</label>
        <textarea name="customer_notes" rows={2} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" placeholder="What the customer said is wrong..." />
      </div>
      <div className="md:col-span-2">
        <button
          type="submit"
          disabled={uploading}
          className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-medium px-6 py-2.5 rounded-lg transition"
        >
          {uploading ? 'Uploading…' : 'Check In Unit'}
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

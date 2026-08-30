'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resizeImage } from '@/lib/resizeImage'

const supabase = createClient()

// Admin-only: lets a photo be attached to a unit at any time, not just
// during check-in. Same bucket/resize pipeline as CheckInForm's photo
// field - uploads client-side, then hands the resulting URL to the
// addUnitPhoto server action, which just inserts the unit_photos row.
export default function UnitPhotoUpload({
  unitId,
  action,
}: {
  unitId: string
  action: (formData: FormData) => Promise<void>
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
      const resized = await resizeImage(file, 1200)
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'jpg'
      const fileName = `unit-${unitId}-${Date.now()}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('invoices')
        .upload(fileName, resized, {
          contentType: 'image/jpeg',
          upsert: false,
        })

      if (uploadError) {
        setError('Photo upload failed. Try again.')
        setUploading(false)
        return
      }

      const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(fileName)
      setPhotoUrl(publicUrl)
    } catch {
      setError('Photo upload failed. Try again.')
    }

    setUploading(false)
  }

  async function handleSubmit(formData: FormData) {
    await action(formData)
    setPhotoUrl(null)
  }

  return (
    <form action={handleSubmit} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="unit_id" value={unitId} />
      <input type="hidden" name="photo_url" value={photoUrl || ''} />
      <label className="text-xs bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded-lg cursor-pointer">
        {uploading ? 'Uploading...' : 'Choose Photo'}
        <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
      </label>
      {photoUrl && (
        <img src={photoUrl} alt="Preview" className="h-10 w-10 object-cover rounded-lg border border-zinc-700" />
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={!photoUrl || uploading}
        className="text-xs bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg"
      >
        Add Photo
      </button>
    </form>
  )
}

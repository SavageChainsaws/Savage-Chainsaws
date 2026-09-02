'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resizeImage } from '@/lib/resizeImage'

const supabase = createClient()

// Matches the 'invoices' storage bucket's file_size_limit.
const MAX_FILE_BYTES = 100 * 1024 * 1024

// Admin-only: lets photos be attached to a unit at any time, not just
// during check-in. Same bucket/resize pipeline as CheckInForm's photo
// field - uploads client-side, then hands the resulting URLs to the
// addUnitPhoto server action, which bulk-inserts the unit_photos rows.
// Multi-select (same pattern as DiagnosisMediaUpload): picking several
// photos at once uploads and saves them together in one action, rather
// than forcing one photo per pick - iOS Safari in particular only offers
// a single-file picker unless the input has `multiple`.
export default function UnitPhotoUpload({
  unitId,
  action,
}: {
  unitId: string
  action: (formData: FormData) => Promise<void>
}) {
  const [uploading, setUploading] = useState(false)
  const [photoUrls, setPhotoUrls] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  async function handlePhotosChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    setUploading(true)
    setError(null)
    const uploaded: string[] = []
    const failures: string[] = []

    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        failures.push(`${file.name} - over the 100MB upload limit`)
        continue
      }
      try {
        const resized = await resizeImage(file, 1200)
        const ext = file.name.includes('.') ? file.name.split('.').pop() : 'jpg'
        const fileName = `unit-${unitId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

        const { error: uploadError } = await supabase.storage
          .from('invoices')
          .upload(fileName, resized, {
            contentType: 'image/jpeg',
            upsert: false,
          })
        if (uploadError) {
          failures.push(`${file.name} - upload failed`)
          continue
        }
        const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(fileName)
        uploaded.push(publicUrl)
      } catch {
        failures.push(`${file.name} - upload failed`)
      }
    }

    setPhotoUrls(prev => [...prev, ...uploaded])
    setError(failures.length > 0 ? failures.join('; ') : null)
    setUploading(false)
    e.target.value = ''
  }

  async function handleSubmit(formData: FormData) {
    for (const url of photoUrls) formData.append('photo_url', url)
    await action(formData)
    setPhotoUrls([])
  }

  return (
    <form action={handleSubmit} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="unit_id" value={unitId} />
      <label className="text-xs bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded-lg cursor-pointer">
        {uploading ? 'Uploading...' : 'Choose Photos'}
        <input type="file" accept="image/*" multiple className="hidden" onChange={handlePhotosChange} disabled={uploading} />
      </label>
      {photoUrls.map(url => (
        <img key={url} src={url} alt="Preview" className="h-10 w-10 object-cover rounded-lg border border-zinc-700" />
      ))}
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={photoUrls.length === 0 || uploading}
        className="text-xs bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg"
      >
        Add {photoUrls.length > 1 ? `${photoUrls.length} Photos` : 'Photo'}
      </button>
    </form>
  )
}

'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resizeImage } from '@/lib/resizeImage'

const supabase = createClient()

// Matches the 'rentals' storage bucket's file_size_limit.
const MAX_FILE_BYTES = 100 * 1024 * 1024

// Condition-photo picker for the rental agreement PDF (before-pickup and
// after-return sets both use this, distinguished only by fieldName/
// filePrefix) - uploads client-side straight to the 'rentals' bucket, then
// exposes each URL as a hidden input under fieldName so the surrounding
// <form> picks them up on submit via formData.getAll(fieldName), the same
// array-of-hidden-inputs convention the invoice forms already use for
// repeated line items.
export default function RentalPhotoUpload({
  fieldName,
  label,
  filePrefix,
}: {
  fieldName: string
  label: string
  filePrefix: string
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
        const fileName = `${filePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

        const { error: uploadError } = await supabase.storage
          .from('rentals')
          .upload(fileName, resized, { contentType: 'image/jpeg', upsert: false })
        if (uploadError) {
          failures.push(`${file.name} - upload failed`)
          continue
        }
        const { data: { publicUrl } } = supabase.storage.from('rentals').getPublicUrl(fileName)
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

  function removePhoto(url: string) {
    setPhotoUrls(prev => prev.filter(u => u !== url))
  }

  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <label className="inline-block text-xs bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded-lg cursor-pointer">
        {uploading ? 'Uploading...' : 'Choose Photos'}
        <input type="file" accept="image/*" multiple className="hidden" onChange={handlePhotosChange} disabled={uploading} />
      </label>
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      {photoUrls.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {photoUrls.map(url => (
            <div key={url} className="relative">
              <img src={url} alt="Preview" className="h-16 w-16 object-cover rounded-lg border border-zinc-700" />
              <input type="hidden" name={fieldName} value={url} />
              <button
                type="button"
                onClick={() => removePhoto(url)}
                className="absolute -top-1.5 -right-1.5 bg-red-600 hover:bg-red-500 text-white rounded-full w-4 h-4 text-[10px] leading-none flex items-center justify-center"
                aria-label="Remove photo"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

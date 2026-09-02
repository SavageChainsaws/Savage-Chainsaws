'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resizeImage } from '@/lib/resizeImage'

const supabase = createClient()

// Matches the 'invoices' storage bucket's file_size_limit (100MB) - checked
// client-side too so a huge video is rejected instantly instead of failing
// partway through an upload.
const MAX_FILE_BYTES = 100 * 1024 * 1024

type PendingItem = { url: string; mediaType: 'photo' | 'video'; name: string }

// Diagnosis Findings media - separate from the check-in photo gallery
// (UnitPhotoUpload/addUnitPhoto), both visually and in what it uploads:
// multiple photos AND videos at once, in one submit. Images still go
// through the shared resizeImage() pipeline; resizeImage is canvas/Image
// based and can't touch video, so video files upload as-is (size-capped
// instead).
export default function DiagnosisMediaUpload({
  unitId,
  action,
}: {
  unitId: string
  action: (formData: FormData) => Promise<void>
}) {
  const [uploading, setUploading] = useState(false)
  const [pending, setPending] = useState<PendingItem[]>([])
  const [error, setError] = useState<string | null>(null)

  async function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    setUploading(true)
    setError(null)
    const uploaded: PendingItem[] = []
    const failures: string[] = []

    for (const file of files) {
      const isVideo = file.type.startsWith('video/')
      const isImage = file.type.startsWith('image/')
      if (!isVideo && !isImage) {
        failures.push(`${file.name} - not a photo or video`)
        continue
      }
      if (file.size > MAX_FILE_BYTES) {
        failures.push(`${file.name} - over the 100MB upload limit`)
        continue
      }

      try {
        const body = isImage ? await resizeImage(file, 1600) : file
        const ext = file.name.includes('.') ? file.name.split('.').pop() : isVideo ? 'mp4' : 'jpg'
        const fileName = `diagnosis-${unitId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

        const { error: uploadError } = await supabase.storage
          .from('invoices')
          .upload(fileName, body, {
            contentType: isImage ? 'image/jpeg' : file.type || 'application/octet-stream',
            upsert: false,
          })
        if (uploadError) {
          failures.push(`${file.name} - upload failed`)
          continue
        }
        const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(fileName)
        uploaded.push({ url: publicUrl, mediaType: isVideo ? 'video' : 'photo', name: file.name })
      } catch {
        failures.push(`${file.name} - upload failed`)
      }
    }

    setPending(prev => [...prev, ...uploaded])
    setError(failures.length > 0 ? failures.join('; ') : null)
    setUploading(false)
    e.target.value = ''
  }

  async function handleSubmit(formData: FormData) {
    for (const item of pending) {
      formData.append('media_url', item.url)
      formData.append('media_type', item.mediaType)
    }
    await action(formData)
    setPending([])
  }

  return (
    <form action={handleSubmit} className="space-y-2">
      <input type="hidden" name="unit_id" value={unitId} />
      <label className="inline-block text-xs bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded-lg cursor-pointer">
        {uploading ? 'Uploading...' : 'Choose Photos / Videos'}
        <input
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={handleFilesChange}
          disabled={uploading}
        />
      </label>

      {pending.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {pending.map((item, i) => (
            <div key={i} className="text-xs bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-gray-300">
              {item.mediaType === 'video' ? 'Video' : 'Photo'}: {item.name}
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={pending.length === 0 || uploading}
        className="text-xs bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg"
      >
        Add {pending.length > 0 ? `${pending.length} ` : ''}to Diagnosis Findings
      </button>
    </form>
  )
}

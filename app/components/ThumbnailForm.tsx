'use client'

import { useActionState, useState } from 'react'

type ThumbState = { savedAt: number } | null

// Lets the admin set/replace a unit's thumbnail at any time (not just at
// check-in) - e.g. it was skipped when the unit came in, or the unit just
// got cleaned up and deserves a better photo. Mirrors NotesForm's
// useActionState pattern; the file itself travels through the native
// multipart form submit straight to the server action, no client-side
// Storage upload needed here.
export default function ThumbnailForm({
  unitId,
  action,
}: {
  unitId: string
  action: (prevState: ThumbState, formData: FormData) => Promise<ThumbState>
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  return (
    // Remounted on every successful save (key changes) so the local blob
    // preview below resets to empty - the real thumbnail_url has already
    // revalidated in by then, so this just collapses back to "Choose Photo".
    <ThumbnailFormFields
      key={state?.savedAt ?? 'initial'}
      unitId={unitId}
      formAction={formAction}
      isPending={isPending}
      savedAt={state?.savedAt}
    />
  )
}

function ThumbnailFormFields({
  unitId,
  formAction,
  isPending,
  savedAt,
}: {
  unitId: string
  formAction: (formData: FormData) => void
  isPending: boolean
  savedAt: number | undefined
}) {
  const [preview, setPreview] = useState<string | null>(null)

  function onPick(file: File | null) {
    if (preview) URL.revokeObjectURL(preview)
    setPreview(file ? URL.createObjectURL(file) : null)
  }

  return (
    <form action={formAction} className="flex items-center gap-2 flex-wrap">
      <input type="hidden" name="id" value={unitId} />
      {preview && (
        <img src={preview} alt="New thumbnail preview" className="h-10 w-10 object-cover rounded-lg border border-orange-500/50" />
      )}
      <label className="inline-flex items-center justify-center bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg cursor-pointer whitespace-nowrap">
        Choose Photo
        <input type="file" name="thumbnail" accept="image/*" className="hidden" onChange={e => onPick(e.target.files?.[0] || null)} />
      </label>
      {preview && (
        <button
          type="submit"
          disabled={isPending}
          className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg whitespace-nowrap"
        >
          {isPending ? 'Uploading...' : 'Save Photo'}
        </button>
      )}
      {savedAt && (
        <span key={savedAt} className="text-xs text-green-400 font-medium animate-fade-out-delayed">
          Saved
        </span>
      )}
    </form>
  )
}

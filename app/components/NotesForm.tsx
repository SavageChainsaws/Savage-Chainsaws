'use client'

import { useActionState } from 'react'

type NotesState = { savedAt: number } | null

export default function NotesForm({
  unitId,
  initialNotes,
  action,
}: {
  unitId: string
  initialNotes: string
  action: (prevState: NotesState, formData: FormData) => Promise<NotesState>
}) {
  const [state, formAction, isPending] = useActionState(action, null)

  return (
    <form action={formAction} className="mt-2">
      <input type="hidden" name="id" value={unitId} />
      <textarea
        name="notes"
        defaultValue={initialNotes}
        rows={2}
        placeholder="Add internal notes..."
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
      />
      <div className="flex items-center gap-2 mt-1.5">
        <button
          type="submit"
          disabled={isPending}
          className="text-xs text-orange-400 hover:text-orange-300 disabled:opacity-50"
        >
          {isPending ? 'Saving...' : 'Save Notes'}
        </button>
        {state && (
          // Remounted (via key) on every save, restarting the fade-out
          // animation - no JS timer needed to hide it again.
          <span key={state.savedAt} className="text-xs text-green-400 font-medium animate-fade-out-delayed">
            Saved
          </span>
        )}
      </div>
    </form>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

// Private, customer-only reference note per unit (e.g. "hard time
// starting") - lives in its own unit_customer_notes table with RLS that
// grants only the owning customer access, so it's genuinely never visible
// to the admin, not just hidden in the admin UI.
//
// Caller must render this with key={unitId} - switching to a different
// unit needs a fresh mount (blank fields until the new unit's note loads),
// not a re-render that carries over the previous unit's note while the
// new one is still fetching.
export default function PrivateNoteEditor({
  unitId,
  onMessage,
}: {
  unitId: string
  onMessage: (message: string) => void
}) {
  const [note, setNote] = useState('')
  const [savedNote, setSavedNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase
      .from('unit_customer_notes')
      .select('notes')
      .eq('unit_id', unitId)
      .maybeSingle()
      .then(({ data }) => {
        setNote(data?.notes || '')
        setSavedNote(data?.notes || '')
      })
  }, [unitId])

  async function save() {
    setBusy(true)
    const trimmed = note.trim()
    const { error } = await supabase
      .from('unit_customer_notes')
      .upsert({ unit_id: unitId, notes: trimmed || null, updated_at: new Date().toISOString() }, { onConflict: 'unit_id' })
    setBusy(false)
    if (error) {
      console.error(error)
      onMessage('Could not save your private note.')
      return
    }
    setSavedNote(trimmed)
    onMessage('Private note saved.')
  }

  return (
    <div className="border-t border-zinc-800 pt-3">
      <label className="block text-xs text-gray-500 mb-1">
        Private Notes <span className="text-zinc-600">(only visible to you, not Jesse)</span>
      </label>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        rows={2}
        placeholder="e.g. This unit has a hard time starting..."
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
      />
      <button
        onClick={save}
        disabled={busy || note === savedNote}
        className="mt-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
      >
        {busy ? 'Saving...' : 'Save Private Note'}
      </button>
    </div>
  )
}

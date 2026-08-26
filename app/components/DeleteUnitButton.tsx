'use client'

import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

export default function DeleteUnitButton({ id }: { id: string }) {
  async function handleDelete() {
    const ok = window.confirm('Delete this unit permanently? This cannot be undone.')
    if (!ok) return

    const { error } = await supabase.from('units').delete().eq('id', id)
    if (error) {
      alert('Could not delete unit: ' + error.message)
      return
    }

    window.location.reload()
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      className="bg-red-700 hover:bg-red-600 text-white text-sm px-4 py-1.5 rounded-lg transition whitespace-nowrap"
    >
      Delete
    </button>
  )
}

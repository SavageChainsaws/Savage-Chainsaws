'use client'

import { useState } from 'react'

// The $49.99 priority fee is fully automatic server-side (updateStatus
// derives it from is_priority, no manual entry) - this just gives instant
// visual confirmation the moment the box is checked, rather than the
// admin only finding out after hitting Update.
export default function PriorityCheckbox({ formId, defaultChecked }: { formId: string; defaultChecked: boolean }) {
  const [checked, setChecked] = useState(defaultChecked)

  return (
    <label className="flex items-center gap-1.5 text-xs text-orange-400 cursor-pointer">
      <input
        form={formId}
        type="checkbox"
        name="is_priority"
        value="true"
        checked={checked}
        onChange={e => setChecked(e.target.checked)}
        className="rounded border-zinc-600 bg-zinc-800 text-orange-500"
      />
      Priority
      {checked && (
        <span className="text-xs bg-orange-500 text-black font-bold rounded-full px-2 py-0.5">+$49.99 fee</span>
      )}
    </label>
  )
}

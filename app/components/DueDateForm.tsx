'use client'

import { useActionState, useState } from 'react'

type State = { success: boolean; message: string } | null

// Jesse's only way to set/confirm an invoice's payment terms - no NET 30 or
// any other default is ever assumed, so an invoice with no due date on
// file shows a flagged "No Due Date" prompt instead of silently treating
// it as current. Also what gates App Bot's reminder-send rule
// (lib/bot/rules.ts's canSendReminder) - it won't send a reminder for an
// invoice with no due date here.
export default function DueDateForm({
  invoiceId,
  dueDate,
  flagMissing,
  action,
}: {
  invoiceId: string
  dueDate: string | null
  flagMissing: boolean
  action: (prevState: State, formData: FormData) => Promise<State>
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  const [editing, setEditing] = useState(false)

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
          dueDate ? 'bg-zinc-700 text-gray-300 hover:bg-zinc-600' : flagMissing ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30' : 'bg-zinc-800 text-gray-500 hover:bg-zinc-700'
        }`}
        title={dueDate ? 'Click to change the due date' : 'No payment terms confirmed yet - click to set one'}
      >
        {dueDate ? `Due ${new Date(`${dueDate}T00:00:00`).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}` : 'No Due Date'}
      </button>
    )
  }

  return (
    <form
      action={async formData => {
        await formAction(formData)
        setEditing(false)
      }}
      className="flex items-center gap-1"
    >
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <input
        type="date"
        name="due_date"
        defaultValue={dueDate || ''}
        autoFocus
        className="bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs"
      />
      <button type="submit" disabled={isPending} className="text-xs text-orange-400 hover:text-orange-300 disabled:opacity-50">
        Save
      </button>
      <button type="button" onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:text-gray-300">
        Cancel
      </button>
      {state && !state.success && <p className="text-xs text-red-400">{state.message}</p>}
    </form>
  )
}

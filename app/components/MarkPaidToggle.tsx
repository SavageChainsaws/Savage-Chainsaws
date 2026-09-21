'use client'

import { useActionState } from 'react'

type State = { success: boolean; message: string } | null

// Lets an admin mark an invoice paid (or undo that) without going through
// Square at all - some customers pay by Zelle, Cash App, or tap-to-pay in
// person, and the invoice needs to reflect that just as clearly as an
// online Square payment does.
export default function MarkPaidToggle({
  invoiceId,
  isPaid,
  action,
}: {
  invoiceId: string
  isPaid: boolean
  action: (prevState: State, formData: FormData) => Promise<State>
}) {
  const [state, formAction, isPending] = useActionState(action, null)

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <input type="hidden" name="invoice_id" value={invoiceId} />
        <input type="hidden" name="next_paid" value={(!isPaid).toString()} />
        <button
          type="submit"
          disabled={isPending}
          className={`text-xs border disabled:opacity-50 px-2 py-1 rounded-lg transition whitespace-nowrap ${
            isPaid
              ? 'border-zinc-700 hover:bg-zinc-800 text-gray-300'
              : 'border-green-700 hover:bg-green-900/30 text-green-400'
          }`}
        >
          {isPending ? 'Saving...' : isPaid ? 'Mark Unpaid' : 'Mark Paid'}
        </button>
      </form>
      {state && !state.success && (
        <p className="text-xs max-w-[220px] text-right text-red-400">{state.message}</p>
      )}
    </div>
  )
}

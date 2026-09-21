'use client'

import { useActionState } from 'react'

type State = { success: boolean; message: string } | null

// Manual archive for an invoice that isn't paid - e.g. cancelled or written
// off - so it can be tucked out of the Active view without falsely marking
// it Paid. Paid invoices archive automatically via paid_at and don't use
// this at all (see app/invoices/page.tsx).
export default function ArchiveToggle({
  invoiceId,
  isArchived,
  action,
}: {
  invoiceId: string
  isArchived: boolean
  action: (prevState: State, formData: FormData) => Promise<State>
}) {
  const [state, formAction, isPending] = useActionState(action, null)

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <input type="hidden" name="invoice_id" value={invoiceId} />
        <input type="hidden" name="next_archived" value={(!isArchived).toString()} />
        <button
          type="submit"
          disabled={isPending}
          title={isArchived ? 'Move back to Active' : 'Archive without marking paid'}
          className="text-xs border border-zinc-700 hover:bg-zinc-800 disabled:opacity-50 text-gray-300 px-1.5 py-1 rounded-lg transition whitespace-nowrap"
        >
          {isPending ? 'Saving...' : isArchived ? 'Unarchive' : 'Archive'}
        </button>
      </form>
      {state && !state.success && (
        <p className="text-xs max-w-[220px] text-right text-red-400">{state.message}</p>
      )}
    </div>
  )
}

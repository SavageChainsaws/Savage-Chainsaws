'use client'

import { useActionState, useEffect, useState } from 'react'

type State = { success: boolean; message: string } | null

// Lets a customer self-report a Zelle payment by its confirmation number,
// since Zelle has no merchant API/webhook to confirm it automatically (see
// app/actions/zelleClaims.ts). Submitting this doesn't mark the invoice
// Paid by itself - onClaimed triggers the caller's own data reload, and
// once that reload sees zelle_claim_reference set, InvoiceListPanel moves
// this invoice out of the "still owed" list on its own; there's nothing
// further for this component to render once that happens.
export default function ZelleClaimForm({
  invoiceId,
  action,
  onClaimed,
}: {
  invoiceId: string
  action: (prevState: State, formData: FormData) => Promise<State>
  onClaimed: () => void
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction, isPending] = useActionState(action, null)

  useEffect(() => {
    if (state?.success) onClaimed()
  }, [state, onClaimed])

  if (state?.success) {
    return <p className="text-xs text-green-400 w-full">{state.message}</p>
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-orange-400 hover:text-orange-300 underline"
      >
        Paid via Zelle?
      </button>
    )
  }

  return (
    <form action={formAction} className="flex items-center gap-1.5 flex-wrap w-full">
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <input
        type="text"
        name="reference"
        required
        placeholder="Zelle confirmation #"
        className="text-xs bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 w-36 focus:outline-none focus:border-orange-500"
      />
      <button
        type="submit"
        disabled={isPending}
        className="text-xs bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-medium px-2 py-1 rounded-lg transition whitespace-nowrap"
      >
        {isPending ? 'Saving...' : 'Submit'}
      </button>
      {state && !state.success && (
        <p className="text-xs text-red-400 w-full">{state.message}</p>
      )}
    </form>
  )
}

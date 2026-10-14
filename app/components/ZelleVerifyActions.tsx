'use client'

import { useActionState } from 'react'

type State = { success: boolean; message: string } | null

// Shown only while an invoice has an unconfirmed customer-submitted Zelle
// claim (see app/actions/zelleClaims.ts). Confirm matches the reference
// against Jesse's own bank activity and marks the invoice really Paid;
// Reject clears the claim and puts it back as a normal unpaid invoice, for
// whenever the number doesn't check out.
export default function ZelleVerifyActions({
  invoiceId,
  reference,
  action,
}: {
  invoiceId: string
  reference: string
  action: (prevState: State, formData: FormData) => Promise<State>
}) {
  const [state, formAction, isPending] = useActionState(action, null)

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1 bg-blue-500/10 border border-blue-500/30 rounded-lg px-2 py-1">
        <span className="text-xs text-blue-300 whitespace-nowrap" title="Customer-submitted Zelle confirmation number - check it against your bank activity">
          Zelle #{reference}
        </span>
        <form action={formAction}>
          <input type="hidden" name="invoice_id" value={invoiceId} />
          <input type="hidden" name="approve" value="true" />
          <button
            type="submit"
            disabled={isPending}
            className="text-xs bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-medium px-2 py-1 rounded-lg transition whitespace-nowrap"
          >
            Confirm
          </button>
        </form>
        <form action={formAction}>
          <input type="hidden" name="invoice_id" value={invoiceId} />
          <input type="hidden" name="approve" value="false" />
          <button
            type="submit"
            disabled={isPending}
            className="text-xs border border-zinc-700 hover:bg-zinc-800 disabled:opacity-50 text-gray-300 px-2 py-1 rounded-lg transition whitespace-nowrap"
          >
            Reject
          </button>
        </form>
      </div>
      {state && !state.success && (
        <p className="text-xs max-w-[220px] text-right text-red-400">{state.message}</p>
      )}
    </div>
  )
}

'use client'

import { useActionState, useState } from 'react'

type State = { success: boolean; message: string } | null

// A custom in-page confirmation modal rather than window.confirm() - harder
// to dismiss with a stray Enter/click than a native browser dialog, and
// makes the "this is permanent" warning impossible to miss.
export default function DeleteInvoiceButton({
  invoiceId,
  invoiceNumber,
  action,
}: {
  invoiceId: string
  invoiceNumber: string
  action: (prevState: State, formData: FormData) => Promise<State>
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  const [confirming, setConfirming] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        title="Delete invoice"
        className="text-xs bg-red-700 hover:bg-red-600 text-white font-medium px-2.5 py-1 rounded-lg transition whitespace-nowrap"
      >
        Delete
      </button>

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setConfirming(false)}
        >
          <div
            className="bg-zinc-900 border border-red-700 rounded-xl p-6 max-w-sm w-full shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-red-400 mb-2">Delete invoice {invoiceNumber}?</h3>
            <p className="text-sm text-gray-400 mb-5">
              This cannot be undone and will remove it from your records permanently.
            </p>
            {state && !state.success && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-4">
                {state.message}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-sm px-4 py-2 rounded-lg border border-zinc-700 hover:bg-zinc-800 transition"
              >
                Cancel
              </button>
              <form action={formAction}>
                <input type="hidden" name="invoice_id" value={invoiceId} />
                <button
                  type="submit"
                  disabled={isPending}
                  className="text-sm px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white font-medium transition"
                >
                  {isPending ? 'Deleting...' : 'Delete Permanently'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

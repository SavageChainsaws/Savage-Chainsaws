'use client'

import { useActionState, useState } from 'react'

type State = { success: boolean; message: string } | null

export default function SendInvoiceButton({
  invoiceId,
  defaultEmail,
  alreadySent,
  action,
}: {
  invoiceId: string
  defaultEmail: string
  alreadySent: boolean
  action: (prevState: State, formData: FormData) => Promise<State>
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  // Editable so an invoice with no stored/linked email (e.g. the real
  // pre-this-feature invoices, generated free-form with no customer_email
  // saved) can still be sent - the admin just confirms or types one.
  const [email, setEmail] = useState(defaultEmail)

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <div className="flex items-center gap-1.5">
        <input
          type="email"
          name="recipient_email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="customer@email.com"
          className="text-xs bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 w-40 focus:outline-none focus:border-orange-500"
        />
        <button
          type="submit"
          disabled={isPending}
          className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium px-2.5 py-1 rounded-lg transition whitespace-nowrap"
        >
          {isPending ? 'Sending...' : alreadySent ? 'Resend' : 'Send Invoice'}
        </button>
      </div>
      {state && (
        <p className={`text-xs max-w-[220px] text-right ${state.success ? 'text-green-400' : 'text-red-400'}`}>
          {state.message}
        </p>
      )}
    </form>
  )
}

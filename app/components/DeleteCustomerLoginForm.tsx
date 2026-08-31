'use client'

import { useActionState } from 'react'

type State = { success: boolean; message: string } | null

export default function DeleteCustomerLoginForm({
  customers,
  action,
}: {
  customers: { id: string; name: string }[]
  action: (prevState: State, formData: FormData) => Promise<State>
}) {
  const [state, formAction, isPending] = useActionState(action, null)

  return (
    <form
      action={formAction}
      onSubmit={e => {
        const select = e.currentTarget.elements.namedItem('customer_id') as HTMLSelectElement | null
        const name = select?.selectedOptions[0]?.text || 'this customer'
        if (!window.confirm(`Permanently delete ${name} - the customer record and its login account, if any? This cannot be undone.`)) {
          e.preventDefault()
        }
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <select
        name="customer_id"
        required
        className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
      >
        <option value="">Select customer to delete...</option>
        {customers.map(c => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <button
        type="submit"
        disabled={isPending}
        className="bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
      >
        {isPending ? 'Deleting...' : 'Delete Customer & Login'}
      </button>

      {state && (
        <p
          className={`w-full text-sm px-3 py-2 rounded-lg border ${
            state.success
              ? 'bg-green-500/10 border-green-500/30 text-green-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}
        >
          {state.message}
        </p>
      )}
    </form>
  )
}

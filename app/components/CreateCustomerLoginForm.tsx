'use client'

import { useActionState, useState } from 'react'

type State = { success: boolean; message: string; password?: string } | null

export default function CreateCustomerLoginForm({
  customers,
  action,
}: {
  customers: { id: string; name: string }[]
  action: (prevState: State, formData: FormData) => Promise<State>
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  const [mode, setMode] = useState<'existing' | 'new'>('existing')

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input
            type="radio"
            name="mode"
            checked={mode === 'existing'}
            onChange={() => setMode('existing')}
            className="text-orange-500"
          />
          Existing customer
        </label>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer ml-4">
          <input
            type="radio"
            name="mode"
            checked={mode === 'new'}
            onChange={() => setMode('new')}
            className="text-orange-500"
          />
          New customer
        </label>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {mode === 'existing' ? (
          <select
            name="customer_id"
            required
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Select customer...</option>
            {customers.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        ) : (
          <input
            name="new_customer_name"
            required
            placeholder="Customer / company name"
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
        )}
        <input
          name="email"
          type="email"
          required
          placeholder="Login email"
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
        />
        <input
          name="password"
          placeholder="Password (blank = auto-generate)"
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={isPending}
          className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
        >
          {isPending ? 'Creating...' : 'Create Login'}
        </button>
      </div>

      {state && (
        <div
          className={`text-sm px-3 py-2 rounded-lg border ${
            state.success
              ? 'bg-green-500/10 border-green-500/30 text-green-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}
        >
          <p>{state.message}</p>
          {state.password && (
            <p className="mt-1">
              Generated password: <span className="font-mono text-white">{state.password}</span> - share this with the customer, they can change it from Settings after logging in.
            </p>
          )}
        </div>
      )}
    </form>
  )
}

'use client'

import { useActionState } from 'react'

type State = { success: boolean; message: string; token?: string } | null

export default function GenerateBotTokenForm({
  action,
}: {
  action: (prevState: State, formData: FormData) => Promise<State>
}) {
  const [state, formAction, isPending] = useActionState(action, null)

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid sm:grid-cols-3 gap-3">
        <select name="bot_name" required className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm">
          <option value="app_bot">App Bot</option>
          <option value="financial_bot">Financial Bot</option>
          <option value="unit_bot">Unit Bot</option>
        </select>
        <input
          name="label"
          placeholder="Label (optional, e.g. 'Grok Bot prod')"
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={isPending}
          className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
        >
          {isPending ? 'Generating...' : 'Generate Token'}
        </button>
      </div>

      {state && (
        <div
          className={`text-sm px-3 py-2 rounded-lg border ${
            state.success ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}
        >
          <p>{state.message}</p>
          {state.token && (
            <p className="mt-2 break-all">
              Token: <span className="font-mono text-white">{state.token}</span>
            </p>
          )}
          {state.token && (
            <p className="mt-1 text-amber-400">
              This will not be shown again - copy it now and deliver it to the bot out-of-band (not in chat, not committed anywhere).
            </p>
          )}
        </div>
      )}
    </form>
  )
}

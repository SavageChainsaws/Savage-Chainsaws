'use client'

import { useActionState } from 'react'
import TitleCaseInput from './TitleCaseInput'

type State = { success: boolean; message: string; password?: string } | null

export default function CreateReferralSourceLoginForm({
  action,
}: {
  action: (prevState: State, formData: FormData) => Promise<State>
}) {
  const [state, formAction, isPending] = useActionState(action, null)

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <TitleCaseInput
          name="name"
          required
          placeholder="Partner name (e.g. Elvis)"
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
        />
        <input
          name="email"
          type="email"
          required
          placeholder="Login email"
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
        />
        <input
          name="phone"
          placeholder="Phone (optional)"
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
        />
        <input
          name="referral_code"
          required
          placeholder="Referral code (e.g. ELVIS)"
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm uppercase"
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
          {isPending ? 'Creating...' : 'Create Referral Partner Login'}
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
              Generated password: <span className="font-mono text-white">{state.password}</span> - share this with the partner.
            </p>
          )}
        </div>
      )}
    </form>
  )
}

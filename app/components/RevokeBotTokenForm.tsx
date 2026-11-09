'use client'

import { useActionState } from 'react'

type State = { success: boolean; message: string } | null

export default function RevokeBotTokenForm({
  tokenId,
  label,
  action,
}: {
  tokenId: string
  label: string
  action: (prevState: State, formData: FormData) => Promise<State>
}) {
  const [state, formAction, isPending] = useActionState(action, null)

  return (
    <form
      action={formAction}
      onSubmit={e => {
        if (!window.confirm(`Revoke ${label}? Any bot still using this token will immediately lose access.`)) {
          e.preventDefault()
        }
      }}
      className="inline"
    >
      <input type="hidden" name="id" value={tokenId} />
      <button
        type="submit"
        disabled={isPending}
        className="text-red-400 hover:text-red-300 text-xs border border-red-500/30 px-2 py-1 rounded-lg disabled:opacity-50"
      >
        {isPending ? 'Revoking...' : 'Revoke'}
      </button>
      {state && !state.success && <p className="text-xs text-red-400 mt-1">{state.message}</p>}
    </form>
  )
}

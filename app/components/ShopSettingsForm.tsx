'use client'

import { useActionState } from 'react'

type State = { success: boolean; message: string } | null

// The one shop-wide setting Jesse needs to change himself without a code
// deploy: the default FL sales tax rate (6% state + 1% Seminole County by
// default - see lib/billing.ts). Every invoice form still lets him override
// this per-invoice on top of whatever's saved here, for jobs outside
// Seminole County.
export default function ShopSettingsForm({
  defaultTaxRatePercent,
  action,
}: {
  defaultTaxRatePercent: number
  action: (prevState: State, formData: FormData) => Promise<State>
}) {
  const [state, formAction, isPending] = useActionState(action, null)

  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label className="block text-xs text-gray-500 mb-1">FL Sales Tax Rate (%)</label>
        <input
          name="fl_sales_tax_rate_percent"
          type="number"
          step="0.01"
          min="0"
          defaultValue={defaultTaxRatePercent}
          className="w-40 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
        />
        <p className="text-xs text-gray-600 mt-1">
          Default for every new invoice (6% FL + 1% Seminole County = 7%) - only applied when the invoice has parts/materials.
          Jesse can still override this per-invoice for jobs in a different county.
        </p>
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
      >
        {isPending ? 'Saving...' : 'Save Tax Rate'}
      </button>

      {state && (
        <div
          className={`text-sm px-3 py-2 rounded-lg border ${
            state.success
              ? 'bg-green-500/10 border-green-500/30 text-green-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}
        >
          {state.message}
        </div>
      )}
    </form>
  )
}

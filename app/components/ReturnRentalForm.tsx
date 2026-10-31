'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import RentalPhotoUpload from './RentalPhotoUpload'
import DictateTextarea from './DictateTextarea'

// Closes out a rental: after-condition photos, fuel status, and any
// damage found (capped client-side too, though /api/rental/return is the
// actual enforcement point - see lib/rentals.ts capDamageCharge).
//
// Submits as a JSON fetch, not a form POST, opening its own tab via
// window.open() synchronously in the click handler (so popup blockers
// allow it) and pointing it at the resulting agreement_pdf_url once ready
// - same pattern as CreateRentalForm, and for the same reason: a plain
// <form target="_blank"> has no real new-tab destination inside an
// installed PWA (no browser chrome to hold one), so it was instead taking
// over the whole standalone app window to show the PDF with no way back
// to the rentals list. onReturned closes the modal and refreshes the
// underlying page once the fetch actually succeeds.
export default function ReturnRentalForm({
  rentalId,
  damageCapAmount,
  onReturned,
}: {
  rentalId: string
  damageCapAmount: number
  onReturned?: () => void
}) {
  const router = useRouter()
  const [postPhotoUrls, setPostPhotoUrls] = useState<string[]>([])
  const [fuelEmpty, setFuelEmpty] = useState(true)
  const [fuelChargeAmount, setFuelChargeAmount] = useState('')
  const [damageChargeAmount, setDamageChargeAmount] = useState('')
  const [returnConditionNotes, setReturnConditionNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const damageOverCap = Number(damageChargeAmount) > damageCapAmount

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    // Opened synchronously, still inside the click's user-activation window,
    // so popup blockers allow it - see CreateRentalForm for the same pattern.
    const newTab = window.open('', '_blank')
    try {
      const res = await fetch('/api/rental/return', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rentalId,
          postPhotoUrls,
          returnConditionNotes,
          fuelTankEmpty: fuelEmpty,
          fuelChargeAmount: Number(fuelChargeAmount) || 0,
          damageChargeAmount: Number(damageChargeAmount) || 0,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        newTab?.close()
        setError(data?.error || `Could not process the return (${res.status}).`)
        return
      }
      if (newTab && data?.rental?.agreement_pdf_url) {
        newTab.location.href = data.rental.agreement_pdf_url
      } else {
        newTab?.close()
      }
      router.refresh()
      onReturned?.()
    } catch {
      newTab?.close()
      setError('Could not reach the server. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <RentalPhotoUpload label="Condition Photos - After Return" filePrefix="rental-post" onChange={setPostPhotoUrls} />

      <div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={fuelEmpty}
            onChange={e => setFuelEmpty(e.target.checked)}
            className="rounded border-zinc-700 bg-zinc-900"
          />
          Returned with fuel tank empty
        </label>
      </div>

      {!fuelEmpty && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Fuel Refill Charge $</label>
          <input
            name="fuel_charge_amount"
            type="number"
            step="0.01"
            min="0"
            value={fuelChargeAmount}
            onChange={e => setFuelChargeAmount(e.target.value)}
            placeholder="0.00"
            className="w-32 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
          />
        </div>
      )}

      <div>
        <label className="block text-xs text-gray-500 mb-1">Damage Charge $ (capped at ${damageCapAmount.toFixed(2)})</label>
        <input
          name="damage_charge_amount"
          type="number"
          step="0.01"
          min="0"
          max={damageCapAmount}
          value={damageChargeAmount}
          onChange={e => setDamageChargeAmount(e.target.value)}
          placeholder="0.00"
          className="w-32 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
        />
        {damageOverCap && (
          <p className="text-xs text-orange-400 mt-1">Will be capped at ${damageCapAmount.toFixed(2)} per the rental agreement&apos;s liability cap.</p>
        )}
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Return Condition Notes</label>
        <DictateTextarea
          name="return_condition_notes"
          value={returnConditionNotes}
          onChange={e => setReturnConditionNotes(e.target.value)}
          rows={2}
          placeholder="Unit returned clean and working, or describe any issues..."
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
        />
      </div>

      <p className="text-xs text-gray-600">
        A $10/day late fee is added automatically if returned after 5 PM on the rental end date. The security deposit
        already collected is applied against any late/fuel/damage charges - a new payment link only appears if the
        total exceeds the deposit.
      </p>

      {error && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg"
      >
        {isSubmitting ? 'Processing...' : 'Confirm Return & Update Agreement'}
      </button>
    </form>
  )
}

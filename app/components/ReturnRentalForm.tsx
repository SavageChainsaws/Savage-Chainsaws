'use client'

import { useState } from 'react'
import RentalPhotoUpload from './RentalPhotoUpload'

// Closes out a rental: after-condition photos, fuel status, and any
// damage found (capped client-side too, though /api/rental/return is the
// actual enforcement point - see lib/rentals.ts capDamageCharge). Submits
// as a plain POST + target="_blank" so the updated agreement PDF (now with
// the Post-Rental Condition section filled in) opens for printing.
export default function ReturnRentalForm({
  rentalId,
  damageCapAmount,
}: {
  rentalId: string
  damageCapAmount: number
}) {
  const [fuelEmpty, setFuelEmpty] = useState(true)
  const [fuelChargeAmount, setFuelChargeAmount] = useState('')
  const [damageChargeAmount, setDamageChargeAmount] = useState('')
  const [returnConditionNotes, setReturnConditionNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const damageOverCap = Number(damageChargeAmount) > damageCapAmount

  return (
    <form
      action="/api/rental/return"
      method="POST"
      target="_blank"
      onSubmit={() => {
        setIsSubmitting(true)
        window.setTimeout(() => setIsSubmitting(false), 3000)
      }}
      className="space-y-3"
    >
      <input type="hidden" name="rental_id" value={rentalId} />

      <RentalPhotoUpload fieldName="post_photo_url" label="Condition Photos - After Return" filePrefix="rental-post" />

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
        <input type="hidden" name="fuel_tank_empty" value={fuelEmpty ? 'true' : 'false'} />
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
        <textarea
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

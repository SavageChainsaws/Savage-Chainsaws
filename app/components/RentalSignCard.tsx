'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { computeRentalDays, rentalAgreementTerms } from '@/lib/rentals'

const supabase = createClient()

type PendingRental = {
  id: string
  renter_name: string
  rental_type: 'daily' | 'weekly'
  rate_amount: number
  start_date: string
  end_date: string
  security_deposit: number
  damage_cap_amount: number
  rental_charge: number
  total_owed: number
  rental_units: { model: string; equipment_type: string; serial_number: string | null; photo_url: string | null } | null
}

// Shown to a portal customer once the admin has assigned them a rental
// unit (a rentals row lands in status 'Pending Signature' - see
// app/api/rental/route.ts) - reads and terms text so the customer can see
// exactly what they're agreeing to, then signs by typing their name and
// tapping "I Agree" rather than a drawn signature. The actual write goes
// through the sign_rental_agreement() RPC via /api/rental/sign so the PDF
// gets generated server-side with the signed name baked in.
export default function RentalSignCard({ customerId }: { customerId: string }) {
  const [rental, setRental] = useState<PendingRental | null>(null)
  const [typedName, setTypedName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signed, setSigned] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data } = await supabase
        .from('rentals')
        .select('id, renter_name, rental_type, rate_amount, start_date, end_date, security_deposit, damage_cap_amount, rental_charge, total_owed, rental_units(model, equipment_type, serial_number, photo_url)')
        .eq('customer_id', customerId)
        .eq('status', 'Pending Signature')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!cancelled) setRental(data as unknown as PendingRental | null)
    }
    load()
    return () => { cancelled = true }
  }, [customerId])

  if (!rental) return null

  if (signed) {
    return (
      <div className="bg-zinc-900 border border-green-500/40 rounded-xl p-4 sm:p-6">
        <p className="text-sm text-green-400">
          Agreement signed - Savage Chainsaws has been notified and will send a payment link shortly.
        </p>
      </div>
    )
  }

  const unit = rental.rental_units
  const days = computeRentalDays(rental.start_date, rental.end_date)
  const terms = rentalAgreementTerms(Number(rental.damage_cap_amount), Number(rental.security_deposit))
  const canSign = typedName.trim().length >= 2

  async function handleSign() {
    if (!canSign || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/rental/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rentalId: rental!.id, signedName: typedName.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || 'Could not sign the agreement. Please try again.')
        return
      }
      setSigned(true)
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-zinc-900 border border-orange-500/50 rounded-xl overflow-hidden">
      <div className="px-4 sm:px-6 py-4 border-b border-zinc-800 bg-orange-500/10">
        <h2 className="text-lg font-semibold text-orange-400">Rental Agreement Ready to Sign</h2>
        <p className="text-xs text-gray-400 mt-1">Review the details below, then type your name to sign electronically.</p>
      </div>
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex gap-3 items-start">
          {unit?.photo_url && (
            <img src={unit.photo_url} alt="" className="h-16 w-16 object-cover rounded-lg border border-zinc-700 shrink-0" />
          )}
          <div>
            <p className="font-medium">{unit ? `${unit.model} - ${unit.equipment_type}` : 'Rental Unit'}</p>
            {unit?.serial_number && <p className="text-xs text-gray-500">Serial: {unit.serial_number}</p>}
          </div>
        </div>

        <div className="bg-zinc-800/40 border border-zinc-800 rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between text-gray-400">
            <span>Rental Period</span>
            <span>{new Date(rental.start_date).toLocaleDateString()} → {new Date(rental.end_date).toLocaleDateString()} ({days} day{days === 1 ? '' : 's'})</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Rate</span>
            <span>{rental.rental_type === 'daily' ? 'Daily' : 'Weekly'} - ${Number(rental.rate_amount).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Rental Charge</span>
            <span>${Number(rental.rental_charge).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Security Deposit (refundable)</span>
            <span>${Number(rental.security_deposit).toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-bold text-orange-400 border-t border-zinc-800 pt-1 mt-1">
            <span>Total Due (payment link sent after signing)</span>
            <span>${Number(rental.total_owed).toFixed(2)}</span>
          </div>
        </div>

        <details className="text-sm">
          <summary className="text-orange-400 cursor-pointer">View full rental terms</summary>
          <div className="mt-2 space-y-2 text-xs text-gray-400">
            {terms.map(term => (
              <div key={term.title}>
                <p className="font-medium text-gray-300">{term.title}</p>
                <p>{term.body}</p>
              </div>
            ))}
          </div>
        </details>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Type your full legal name to sign</label>
          <input
            value={typedName}
            onChange={e => setTypedName(e.target.value)}
            placeholder={rental.renter_name}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="button"
          onClick={handleSign}
          disabled={!canSign || submitting}
          className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-lg"
        >
          {submitting ? 'Signing...' : 'I Agree & Sign'}
        </button>
      </div>
    </div>
  )
}

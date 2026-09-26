'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import RentalPhotoUpload from './RentalPhotoUpload'
import { liveTitleCase } from '@/lib/text'
import { computeRentalDays, computeRentalCharge, type RentalType } from '@/lib/rentals'

type RentalUnitOption = {
  id: string
  model: string
  equipmentType: string
  serialNumber: string | null
  dailyRate: number
  weeklyRate: number
  securityDeposit: number
  damageCap: number
}
type CustomerOption = { id: string; name: string; email: string | null; phone: string | null }

// Creates a rental agreement against an available rental_units row - picks
// from the tracked inventory (never free-typed equipment) so two rentals
// can't accidentally point at the same physical saw. Submits as a JSON
// fetch (not a form POST) since /api/rental takes a JSON body - condition
// photos are still uploaded client-side beforehand (RentalPhotoUpload),
// their URLs just travel as a plain array in that JSON rather than as
// repeated hidden form fields. The charge is the daily/weekly rate
// prorated by how long the rental spans (see lib/rentals.ts
// computeRentalCharge) - this live estimate mirrors the server's own
// calculation exactly by importing the same function, never recomputing
// it separately.
export default function CreateRentalForm({
  rentalUnits,
  customers,
  defaultRentalUnitId,
  defaultCustomerId,
}: {
  rentalUnits: RentalUnitOption[]
  customers: CustomerOption[]
  defaultRentalUnitId?: string
  defaultCustomerId?: string
}) {
  const router = useRouter()
  const [unitId, setUnitId] = useState(defaultRentalUnitId || rentalUnits[0]?.id || '')
  const [customerId, setCustomerId] = useState(defaultCustomerId || '')
  const [renterName, setRenterName] = useState('')
  const [renterCompany, setRenterCompany] = useState('')
  const [renterPhone, setRenterPhone] = useState('')
  const [renterEmail, setRenterEmail] = useState('')
  const [driverLicense, setDriverLicense] = useState('')
  const [rentalType, setRentalType] = useState<RentalType>('daily')
  const today = new Date().toISOString().slice(0, 10)
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [preExistingDamageNotes, setPreExistingDamageNotes] = useState('')
  const [prePhotoUrls, setPrePhotoUrls] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedUnit = rentalUnits.find(u => u.id === unitId)
  const days = computeRentalDays(startDate, endDate)
  const rentalCharge = selectedUnit ? computeRentalCharge(rentalType, selectedUnit.dailyRate, selectedUnit.weeklyRate, days) : 0
  const estimatedDueAtPickup = rentalCharge + (selectedUnit?.securityDeposit || 0)

  function handleSelectCustomer(id: string) {
    setCustomerId(id)
    const c = customers.find(c => c.id === id)
    if (c) {
      setRenterName(c.name || '')
      setRenterPhone(c.phone || '')
      setRenterEmail(c.email || '')
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!selectedUnit) {
      setError('Select a rental unit.')
      return
    }
    if (new Date(endDate) < new Date(startDate)) {
      setError('End date must be on or after the start date.')
      return
    }
    setError(null)
    setIsSubmitting(true)
    // Opened synchronously, still inside the click's user-activation window,
    // so popup blockers allow it - see CreateCustomInvoiceForm for the same
    // pattern (a JSON fetch can't itself trigger a browser navigation).
    const newTab = window.open('', '_blank')
    try {
      const res = await fetch('/api/rental', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unitId,
          customerId,
          renterName,
          renterCompany,
          renterPhone,
          renterEmail,
          driverLicense,
          rentalType,
          startDate,
          endDate,
          preExistingDamageNotes,
          prePhotoUrls,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        newTab?.close()
        setError(data?.error || `Could not create the rental (${res.status}).`)
        return
      }
      if (newTab && data?.rental?.agreement_pdf_url) {
        newTab.location.href = data.rental.agreement_pdf_url
      } else {
        newTab?.close()
      }
      router.refresh()
    } catch {
      newTab?.close()
      setError('Could not reach the server. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-xs text-gray-500 mb-1">Rental Unit</label>
        <select
          value={unitId}
          onChange={e => setUnitId(e.target.value)}
          required
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">Select a unit...</option>
          {rentalUnits.map(u => (
            <option key={u.id} value={u.id}>
              {u.model} - {u.equipmentType}{u.serialNumber ? ` (${u.serialNumber})` : ''}
            </option>
          ))}
        </select>
        {rentalUnits.length === 0 && (
          <p className="text-xs text-orange-400 mt-1">No available rental units - add one to the fleet or wait for a return.</p>
        )}
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Link an Existing Customer (Optional)</label>
        <select
          value={customerId}
          onChange={e => handleSelectCustomer(e.target.value)}
          className="w-full sm:w-80 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">Walk-in - no customer selected</option>
          {customers.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Renter Name</label>
          <input
            value={renterName}
            onChange={e => setRenterName(liveTitleCase(e.target.value))}
            required
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Company (optional)</label>
          <input
            value={renterCompany}
            onChange={e => setRenterCompany(liveTitleCase(e.target.value))}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Phone</label>
          <input
            value={renterPhone}
            onChange={e => setRenterPhone(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Email (optional)</label>
          <input
            type="email"
            value={renterEmail}
            onChange={e => setRenterEmail(e.target.value)}
            placeholder="For the Square payment receipt"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Driver&apos;s License #</label>
          <input
            value={driverLicense}
            onChange={e => setDriverLicense(e.target.value.toUpperCase())}
            required
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Rental Type</label>
          <select
            value={rentalType}
            onChange={e => setRentalType(e.target.value as RentalType)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          >
            <option value="daily">Daily {selectedUnit ? `- $${selectedUnit.dailyRate.toFixed(2)}/day` : ''}</option>
            <option value="weekly">Weekly {selectedUnit ? `- $${selectedUnit.weeklyRate.toFixed(2)}/week` : ''}</option>
          </select>
        </div>
        <div />
        <div>
          <label className="block text-xs text-gray-500 mb-1">Rental Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            required
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Rental End Date</label>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            required
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Pre-Existing Damage (noted before renter takes possession)</label>
        <textarea
          value={preExistingDamageNotes}
          onChange={e => setPreExistingDamageNotes(e.target.value)}
          rows={2}
          placeholder="None, or describe any existing wear/damage..."
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
        />
      </div>

      <RentalPhotoUpload label="Condition Photos - Before Pickup" filePrefix="rental-pre" onChange={setPrePhotoUrls} />

      {selectedUnit && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between text-gray-400">
            <span>Rental Charge ({days} day{days === 1 ? '' : 's'})</span>
            <span>${rentalCharge.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Security Deposit (refundable)</span>
            <span>${selectedUnit.securityDeposit.toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-bold text-orange-400 border-t border-zinc-800 pt-1 mt-1">
            <span>Due at Pickup</span>
            <span>${estimatedDueAtPickup.toFixed(2)}</span>
          </div>
          <p className="text-xs text-gray-600">Damage liability capped at ${selectedUnit.damageCap.toFixed(2)} per the rental agreement.</p>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={isSubmitting || rentalUnits.length === 0}
        className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg"
      >
        {isSubmitting ? 'Generating...' : 'Create Rental & Generate Agreement'}
      </button>
    </form>
  )
}

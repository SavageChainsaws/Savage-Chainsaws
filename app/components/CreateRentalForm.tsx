'use client'

import { useState } from 'react'
import RentalPhotoUpload from './RentalPhotoUpload'
import { liveTitleCase } from '@/lib/text'
import type { RentalType } from '@/lib/rentals'

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
// can't accidentally point at the same physical saw. Submits as a plain
// POST + target="_blank" (like CreateUnitInvoiceForm) so the generated
// agreement PDF opens immediately for printing/signing.
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
  const [rentalUnitId, setRentalUnitId] = useState(defaultRentalUnitId || rentalUnits[0]?.id || '')
  const [customerId, setCustomerId] = useState(defaultCustomerId || '')
  const [renterName, setRenterName] = useState('')
  const [renterCompany, setRenterCompany] = useState('')
  const [renterPhone, setRenterPhone] = useState('')
  const [renterLicense, setRenterLicense] = useState('')
  const [rentalType, setRentalType] = useState<RentalType>('daily')
  const today = new Date().toISOString().slice(0, 10)
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [preExistingDamageNotes, setPreExistingDamageNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedUnit = rentalUnits.find(u => u.id === rentalUnitId)
  const rate = selectedUnit ? (rentalType === 'daily' ? selectedUnit.dailyRate : selectedUnit.weeklyRate) : 0
  const days = Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000))
  const estimatedCharge = selectedUnit
    ? rentalType === 'weekly'
      ? rate * Math.ceil(days / 7)
      : rate * days
    : 0
  const estimatedDueAtPickup = estimatedCharge + (selectedUnit?.securityDeposit || 0)

  function handleSelectCustomer(id: string) {
    setCustomerId(id)
    const c = customers.find(c => c.id === id)
    if (c) {
      setRenterName(c.name || '')
      setRenterPhone(c.phone || '')
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (!selectedUnit) {
      e.preventDefault()
      setError('Select a rental unit.')
      return
    }
    if (new Date(endDate) < new Date(startDate)) {
      e.preventDefault()
      setError('End date must be on or after the start date.')
      return
    }
    setError(null)
    setIsSubmitting(true)
    // Let the native POST (target="_blank") proceed - isSubmitting only
    // guards the button's own disabled state, since this navigates a new
    // tab rather than awaiting a fetch response.
    window.setTimeout(() => setIsSubmitting(false), 3000)
  }

  return (
    <form action="/api/rental" method="POST" target="_blank" onSubmit={handleSubmit} className="space-y-3">
      <input type="hidden" name="customer_id" value={customerId} />

      <div>
        <label className="block text-xs text-gray-500 mb-1">Rental Unit</label>
        <select
          name="rental_unit_id"
          value={rentalUnitId}
          onChange={e => setRentalUnitId(e.target.value)}
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
            name="renter_name"
            value={renterName}
            onChange={e => setRenterName(liveTitleCase(e.target.value))}
            required
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Company (optional)</label>
          <input
            name="renter_company"
            value={renterCompany}
            onChange={e => setRenterCompany(liveTitleCase(e.target.value))}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Phone</label>
          <input
            name="renter_phone"
            value={renterPhone}
            onChange={e => setRenterPhone(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Driver&apos;s License #</label>
          <input
            name="renter_license"
            value={renterLicense}
            onChange={e => setRenterLicense(e.target.value.toUpperCase())}
            required
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Rental Type</label>
          <select
            name="rental_type"
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
            name="start_date"
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
            name="end_date"
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
          name="pre_existing_damage_notes"
          value={preExistingDamageNotes}
          onChange={e => setPreExistingDamageNotes(e.target.value)}
          rows={2}
          placeholder="None, or describe any existing wear/damage..."
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
        />
      </div>

      <RentalPhotoUpload fieldName="pre_photo_url" label="Condition Photos - Before Pickup" filePrefix="rental-pre" />

      {selectedUnit && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between text-gray-400">
            <span>Rental Charge ({days} day{days === 1 ? '' : 's'})</span>
            <span>${estimatedCharge.toFixed(2)}</span>
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

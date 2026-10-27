'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import SignaturePad from './SignaturePad'
import { liveTitleCase } from '@/lib/text'
import {
  computeRentalFee, computeDepositAmount,
  RATE_PER_UNIT_PER_DAY, RATE_PER_UNIT_THREE_DAY_PACKAGE, DEPOSIT_PER_UNIT, LATE_FEE_PER_UNIT_PER_DAY,
  type RateType, type AgreementUnit,
} from '@/lib/multiUnitRentalAgreement'

const supabase = createClient()

type CustomerOption = { id: string; name: string; email: string | null; phone: string | null }
type Step = 'setup' | 'sign' | 'done'

const BLANK_UNIT: AgreementUnit = { model: '', serialNumber: '', conditionAtPickup: '' }

function randomSignatureFileName(): string {
  return `agreement-signatures/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
}

// The whole "Jesse fills in the job, hands the phone to the customer, they
// draw their signature, it's emailed to both" flow in one place - deliberately
// one component with two screens (setup/sign) rather than two separate
// pages, since this all happens on Jesse's own device in one sitting out in
// the field. See NewRentalAgreementButton for the modal wrapper.
export default function CreateRentalAgreementFlow({
  customers,
  onDone,
}: {
  customers: CustomerOption[]
  onDone?: () => void
}) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('setup')
  const [customerId, setCustomerId] = useState('')
  const [renterName, setRenterName] = useState('')
  const [renterPhone, setRenterPhone] = useState('')
  const [renterEmail, setRenterEmail] = useState('')
  const [units, setUnits] = useState<AgreementUnit[]>([{ ...BLANK_UNIT }, { ...BLANK_UNIT }, { ...BLANK_UNIT }])
  const today = new Date().toISOString().slice(0, 10)
  const [rentalStart, setRentalStart] = useState(today)
  const [dueBack, setDueBack] = useState(today)
  const [rateType, setRateType] = useState<RateType>('daily')
  const [depositReceived, setDepositReceived] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [renterSignatureDataUrl, setRenterSignatureDataUrl] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)

  const filledUnits = units.filter(u => u.model.trim().length > 0)
  const rentalFee = computeRentalFee(rateType, filledUnits.length)
  const depositAmount = computeDepositAmount(filledUnits.length)

  function handleSelectCustomer(id: string) {
    setCustomerId(id)
    const c = customers.find(c => c.id === id)
    if (c) {
      setRenterName(c.name || '')
      setRenterPhone(c.phone || '')
      setRenterEmail(c.email || '')
    }
  }

  function updateUnit(i: number, field: keyof AgreementUnit, value: string) {
    setUnits(prev => prev.map((u, idx) => (idx === i ? { ...u, [field]: value } : u)))
  }
  function addUnit() {
    setUnits(prev => [...prev, { ...BLANK_UNIT }])
  }
  function removeUnit(i: number) {
    setUnits(prev => prev.filter((_, idx) => idx !== i))
  }

  function handleContinue() {
    setError(null)
    if (!renterName.trim()) {
      setError('Enter the renter’s name.')
      return
    }
    if (filledUnits.length === 0) {
      setError('Add at least one unit (model required).')
      return
    }
    if (new Date(dueBack) < new Date(rentalStart)) {
      setError('Due back date must be on or after the rental start date.')
      return
    }
    setStep('sign')
  }

  async function handleSign() {
    if (!renterSignatureDataUrl || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const sigRes = await fetch(renterSignatureDataUrl)
      const sigBlob = await sigRes.blob()
      const sigFileName = randomSignatureFileName()
      const { error: uploadError } = await supabase.storage
        .from('rentals')
        .upload(sigFileName, sigBlob, { contentType: 'image/png', upsert: false })
      if (uploadError) {
        setError(`Could not save the signature: ${uploadError.message}`)
        return
      }
      const { data: { publicUrl: renterSignatureUrl } } = supabase.storage.from('rentals').getPublicUrl(sigFileName)

      const res = await fetch('/api/rental-agreement/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: customerId || null,
          renterName,
          renterPhone,
          renterEmail,
          units: filledUnits,
          rentalStart,
          dueBack,
          rateType,
          depositReceived: depositReceived ? Number(depositReceived) : null,
          paymentMethod: paymentMethod || null,
          renterSignatureUrl,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || `Could not finalize the agreement (${res.status}).`)
        return
      }
      setPdfUrl(data.pdfUrl || null)
      setStep('done')
      router.refresh()
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (step === 'done') {
    return (
      <div className="space-y-4 text-center py-4">
        <p className="text-green-400 font-medium">Signed and emailed to both of you.</p>
        {pdfUrl && (
          <a href={pdfUrl} target="_blank" rel="noreferrer" className="text-sm text-orange-400 hover:text-orange-300 underline">
            View the signed agreement PDF
          </a>
        )}
        <div>
          <button
            type="button"
            onClick={() => onDone?.()}
            className="mt-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-sm px-4 py-2 rounded-lg"
          >
            Close
          </button>
        </div>
      </div>
    )
  }

  if (step === 'sign') {
    return (
      <div className="space-y-4">
        <div className="bg-zinc-800/50 border border-zinc-800 rounded-lg p-3 text-sm space-y-2">
          <p className="font-medium text-white">{renterName}</p>
          <p className="text-gray-400 text-xs">
            {filledUnits.length} unit{filledUnits.length === 1 ? '' : 's'}: {filledUnits.map(u => u.model).join(', ')}
          </p>
          <div className="flex justify-between text-gray-400">
            <span>Rental Period</span>
            <span>{rentalStart} &rarr; {dueBack}</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Rate</span>
            <span>{rateType === 'daily' ? `$${RATE_PER_UNIT_PER_DAY}/unit/day` : `$${RATE_PER_UNIT_THREE_DAY_PACKAGE}/unit (3-day package)`}</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Security Deposit (refundable)</span>
            <span>${depositAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-bold text-orange-400 border-t border-zinc-800 pt-1">
            <span>Rental Fee</span>
            <span>${rentalFee.toFixed(2)}</span>
          </div>
        </div>

        <details className="text-xs text-gray-400">
          <summary className="text-orange-400 cursor-pointer">View full rental terms</summary>
          <div className="mt-2 space-y-2">
            <p>Renter is solely responsible for proper and safe use of the equipment and will use only 50:1 premix fuel - no straight gas.</p>
            <p>Renter assumes full responsibility for damage, up to 75% of the unit&apos;s current STIHL USA retail price (new) per unit, and for loss/theft at the same rate.</p>
            <p>Late return: ${LATE_FEE_PER_UNIT_PER_DAY}/unit/day after the due date. Security deposit (${DEPOSIT_PER_UNIT}/unit) is refundable and may be applied toward damage.</p>
            <p>Governed by Florida law. By signing, Renter confirms they have read and agree to the full agreement (emailed as a PDF after signing).</p>
          </div>
        </details>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Renter: sign below to agree</label>
          <SignaturePad onChange={setRenterSignatureDataUrl} />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setStep('setup')}
            className="text-sm text-gray-400 hover:text-gray-300 px-2"
          >
            Back
          </button>
          <button
            type="button"
            onClick={handleSign}
            disabled={!renterSignatureDataUrl || submitting}
            className="flex-1 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-lg"
          >
            {submitting ? 'Finalizing...' : 'I Agree & Sign'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-gray-500 mb-1">Link an Existing Customer (Optional)</label>
        <select
          value={customerId}
          onChange={e => handleSelectCustomer(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">Walk-in - no customer selected</option>
          {customers.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
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
          <label className="block text-xs text-gray-500 mb-1">Phone</label>
          <input value={renterPhone} onChange={e => setRenterPhone(e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Email</label>
          <input
            type="email"
            value={renterEmail}
            onChange={e => setRenterEmail(e.target.value)}
            placeholder="So they get a copy once signed"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Units</label>
        <div className="space-y-2">
          {units.map((u, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input
                value={u.model}
                onChange={e => updateUnit(i, 'model', e.target.value)}
                placeholder="Model (e.g. STIHL MS 251)"
                className="flex-1 min-w-[140px] bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
              />
              <input
                value={u.serialNumber}
                onChange={e => updateUnit(i, 'serialNumber', e.target.value.toUpperCase())}
                placeholder="Serial #"
                className="w-32 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
              />
              <input
                value={u.conditionAtPickup}
                onChange={e => updateUnit(i, 'conditionAtPickup', e.target.value)}
                placeholder="Condition at pickup"
                className="w-40 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
              />
              {units.length > 1 && (
                <button type="button" onClick={() => removeUnit(i)} className="text-xs text-red-400 hover:text-red-300">
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addUnit}
          className="mt-2 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-orange-400 px-3 py-1.5 rounded-lg"
        >
          + Add Unit
        </button>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Rental Start</label>
          <input type="date" value={rentalStart} onChange={e => setRentalStart(e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Due Back</label>
          <input type="date" value={dueBack} onChange={e => setDueBack(e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-2">Rate</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" checked={rateType === 'daily'} onChange={() => setRateType('daily')} className="text-orange-500" />
            Daily - ${RATE_PER_UNIT_PER_DAY}/unit/day
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" checked={rateType === 'three_day_package'} onChange={() => setRateType('three_day_package')} className="text-orange-500" />
            3-Day Package - ${RATE_PER_UNIT_THREE_DAY_PACKAGE}/unit
          </label>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Deposit Received $ (optional)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={depositReceived}
            onChange={e => setDepositReceived(e.target.value)}
            placeholder={depositAmount.toFixed(2)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Payment Method (optional)</label>
          <input value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} placeholder="Cash, card, Zelle..." className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      {filledUnits.length > 0 && (
        <div className="bg-zinc-800/40 border border-zinc-800 rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between text-gray-400">
            <span>Rental Fee ({filledUnits.length} unit{filledUnits.length === 1 ? '' : 's'})</span>
            <span>${rentalFee.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Security Deposit (refundable)</span>
            <span>${depositAmount.toFixed(2)}</span>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="button"
        onClick={handleContinue}
        className="w-full bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-5 py-2.5 rounded-lg"
      >
        Continue to Signature
      </button>
    </div>
  )
}

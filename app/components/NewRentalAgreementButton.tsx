'use client'

import { useState } from 'react'
import CreateRentalAgreementFlow from './CreateRentalAgreementFlow'

type CustomerOption = { id: string; name: string; email: string | null; phone: string | null }

// Modal wrapper for CreateRentalAgreementFlow - separate from Create Rental
// above it (that one tracks a single rental_units row through its own
// Pending/Active/Returned lifecycle). This is for the printed multi-unit
// "Chainsaw Equipment Rental Agreement" form: pick/type the renter, list
// whatever units are going out together, hand the phone to the customer to
// sign right there, and it emails the signed PDF to both of you - no
// per-unit fleet tracking involved. No onClick-to-close on the backdrop,
// same reasoning as CreateInvoiceButton - a stray tap shouldn't wipe out a
// customer's in-progress signature.
export default function NewRentalAgreementButton({ customers }: { customers: CustomerOption[] }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition whitespace-nowrap"
      >
        + New Rental Agreement
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 overflow-y-auto">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-2xl w-full shadow-2xl my-8" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-orange-400">New Rental Agreement</h3>
                <p className="text-xs text-gray-500 mt-1">
                  Fill in the job, then hand your phone to the customer to review and sign.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Close"
                className="text-gray-500 hover:text-white text-xl leading-none px-1"
              >
                ×
              </button>
            </div>
            <CreateRentalAgreementFlow customers={customers} onDone={() => setIsOpen(false)} />
          </div>
        </div>
      )}
    </>
  )
}

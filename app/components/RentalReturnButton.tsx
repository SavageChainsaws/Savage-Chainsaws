'use client'

import { useState } from 'react'
import ReturnRentalForm from './ReturnRentalForm'

// Modal wrapper for ReturnRentalForm - mirrors EditInvoiceButton's pattern
// (a flat rentals list row has no room to expand a whole close-out form
// inline).
export default function RentalReturnButton({
  rentalId,
  unitLabel,
  damageCapAmount,
}: {
  rentalId: string
  unitLabel: string
  damageCapAmount: number
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs bg-green-600 hover:bg-green-500 text-white px-2 py-1 rounded-lg transition whitespace-nowrap"
      >
        Return
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-start sm:items-center justify-center p-4 overflow-y-auto"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5 max-w-lg w-full my-8"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-white">Return - {unitLabel}</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-gray-500 hover:text-gray-300 text-xl leading-none px-1"
                aria-label="Close"
              >
                &times;
              </button>
            </div>
            <ReturnRentalForm rentalId={rentalId} damageCapAmount={damageCapAmount} />
          </div>
        </div>
      )}
    </>
  )
}

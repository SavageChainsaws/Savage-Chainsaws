'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import CreateCustomInvoiceForm from './CreateCustomInvoiceForm'

type CustomerOption = {
  id: string
  name: string
  email: string | null
  phone: string | null
}

// Reuses the same standalone-invoice flow already on the dashboard (see
// app/page.tsx) rather than a separate form - a modal here just means Jesse
// doesn't have to leave the invoices list to reach it. router.refresh() on
// completion re-runs this server-rendered page against Supabase, so the new
// invoice shows up in the Active tab without a manual reload.
export default function CreateInvoiceButton({
  customers,
  defaultTaxRatePercent,
}: {
  customers: CustomerOption[]
  defaultTaxRatePercent: number
}) {
  const [isOpen, setIsOpen] = useState(false)
  const router = useRouter()

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition whitespace-nowrap"
      >
        + New Invoice
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/70 p-4 overflow-y-auto"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-2xl w-full shadow-2xl my-8"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-orange-400">Create Invoice</h3>
                <p className="text-xs text-gray-500 mt-1">
                  Standalone itemized invoice - link an existing customer to auto-fill their info, or type everything from scratch.
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
            <CreateCustomInvoiceForm
              customers={customers}
              defaultTaxRatePercent={defaultTaxRatePercent}
              onCreated={() => {
                setIsOpen(false)
                router.refresh()
              }}
            />
          </div>
        </div>
      )}
    </>
  )
}

'use client'

import { useState } from 'react'
import EditInvoiceForm from './EditInvoiceForm'
import { parseInvoiceLineItemsForEdit, type BillingLine } from '@/lib/billing'

// Lets Jesse edit an invoice's line items directly from the /invoices table
// - the table-row counterpart to app/page.tsx's EditInvoiceSection (which
// lives inside a unit's expanded panel). A flat table row has no room to
// expand a whole line-item editor inline, so this opens the shared
// EditInvoiceForm in a modal instead; both paths hit the same
// /api/invoice/edit route.
export default function EditInvoiceButton({
  invoiceId,
  invoiceNumber,
  amount,
  lineItems,
  taxRatePercent,
  includeCardSurcharge,
  laborType,
  isPaid,
  hasPaymentLink,
}: {
  invoiceId: string
  invoiceNumber: string
  amount: number
  lineItems: BillingLine[] | null
  taxRatePercent: number
  includeCardSurcharge: boolean
  laborType: 'STLA' | 'NTSTLA' | null
  isPaid: boolean
  hasPaymentLink: boolean
}) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs border border-zinc-700 hover:bg-zinc-800 text-gray-300 px-2 py-1 rounded-lg transition whitespace-nowrap"
      >
        Edit
      </button>
    )
  }

  const parsed = parseInvoiceLineItemsForEdit(lineItems)
  const hasParts = parsed.partsItems.some(it => it.description.trim().length > 0)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs border border-zinc-700 hover:bg-zinc-800 text-gray-300 px-2 py-1 rounded-lg transition whitespace-nowrap"
      >
        Edit
      </button>
      <div
        className="fixed inset-0 z-50 bg-black/70 flex items-start sm:items-center justify-center p-4 overflow-y-auto"
        onClick={() => setOpen(false)}
      >
        <div
          className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5 max-w-lg w-full my-8"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-bold text-white">Edit Invoice {invoiceNumber}</h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-gray-500 hover:text-gray-300 text-xl leading-none px-1"
              aria-label="Close"
            >
              &times;
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs mb-3">
            <span className="text-gray-500">Current total:</span>
            <span className="font-bold text-orange-400">${amount.toFixed(2)}</span>
            {isPaid ? (
              <span className="px-1.5 py-0.5 rounded-full font-medium bg-green-500/20 text-green-400">
                Already Paid - editing still allowed, but double-check with the customer first
              </span>
            ) : hasPaymentLink ? (
              <span className="px-1.5 py-0.5 rounded-full font-medium bg-yellow-500/20 text-yellow-400">
                Has a Payment Link - saving will clear it so a fresh one matches the new total
              </span>
            ) : null}
          </div>
          <EditInvoiceForm
            invoiceId={invoiceId}
            initialPartsItems={parsed.partsItems}
            initialLaborItems={parsed.laborItems}
            initialPriorityFee={parsed.priorityFee}
            initialReferralDiscountAmount={parsed.referralDiscountAmount}
            taxRatePercent={taxRatePercent}
            includeCardSurcharge={includeCardSurcharge}
            laborType={laborType || (hasParts ? 'STLA' : 'NTSTLA')}
            onSubmit={() => setOpen(false)}
          />
        </div>
      </div>
    </>
  )
}

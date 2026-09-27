'use client'

import { useActionState, useState } from 'react'
import InvoicePaymentActions from './InvoicePaymentActions'
import MarkPaidToggle from './MarkPaidToggle'

type PlanState = { success: boolean; message: string } | null
type LinkState = { success: boolean; message: string; url?: string } | null
type StatusState = { success: boolean; message: string; paid?: boolean } | null
type MarkState = { success: boolean; message: string } | null

type Installment = {
  id: string
  sequence: number
  amount: number
  dueDate: string | null
  paidAt: string | null
  paidVia: string | null
  paymentLinkUrl: string | null
}

type Plan = {
  id: string
  installmentCount: number
  frequency: string
  status: string
  installments: Installment[]
} | null

// Lets an eligible customer's invoice (see the "Allow payment plans"
// checkbox on Edit Customer) be split into scheduled installments instead
// of one all-or-nothing charge - each installment gets its own on-demand
// Square Payment Link via the same InvoicePaymentActions/MarkPaidToggle
// components regular invoices already use, so paying one off (online or
// manually) works identically. The invoice itself auto-marks Paid once
// every installment clears (see maybeCompletePlan in app/invoices/page.tsx)
// - nothing here needs to be "acknowledged" by hand.
export default function PaymentPlanSection({
  invoiceId,
  isPaid,
  paymentPlansEnabledForCustomer,
  plan,
  startPlanAction,
  generateLinkAction,
  checkStatusAction,
  toggleManualPaidAction,
}: {
  invoiceId: string
  isPaid: boolean
  paymentPlansEnabledForCustomer: boolean
  plan: Plan
  startPlanAction: (prevState: PlanState, formData: FormData) => Promise<PlanState>
  generateLinkAction: (prevState: LinkState, formData: FormData) => Promise<LinkState>
  checkStatusAction: (prevState: StatusState, formData: FormData) => Promise<StatusState>
  toggleManualPaidAction: (prevState: MarkState, formData: FormData) => Promise<MarkState>
}) {
  const [startState, startAction, startPending] = useActionState(startPlanAction, null)
  const [showForm, setShowForm] = useState(false)

  if (!plan) {
    // Nothing to offer if this invoice is already paid, or its customer
    // hasn't been opted in - keeps the table clean for the common case.
    if (isPaid || !paymentPlansEnabledForCustomer) return null
    return (
      <div className="pt-1">
        {!showForm ? (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="text-xs text-orange-400 hover:text-orange-300 underline"
          >
            Split into Payments
          </button>
        ) : (
          <form action={startAction} className="flex flex-wrap items-end gap-2 bg-zinc-800/40 border border-zinc-800 rounded-lg p-3 mt-1">
            <input type="hidden" name="invoice_id" value={invoiceId} />
            <div>
              <label className="block text-xs text-gray-500 mb-1">Installments</label>
              <select name="installment_count" defaultValue="4" className="text-sm bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5">
                {[2, 3, 4, 6].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Frequency</label>
              <select name="frequency" defaultValue="weekly" className="text-sm bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5">
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every 2 Weeks</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={startPending}
              className="text-sm bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-medium px-3 py-1.5 rounded-lg"
            >
              {startPending ? 'Creating...' : 'Create Plan'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="text-xs text-gray-500 hover:text-gray-300 px-1 py-1.5">
              Cancel
            </button>
            {startState && !startState.success && <p className="w-full text-xs text-red-400">{startState.message}</p>}
          </form>
        )}
      </div>
    )
  }

  const paidCount = plan.installments.filter(i => i.paidAt).length
  const remaining = plan.installments.reduce((sum, i) => sum + (i.paidAt ? 0 : i.amount), 0)

  return (
    <details className="mt-1" open={plan.status === 'Active'}>
      <summary className="text-xs cursor-pointer list-none inline-flex items-center gap-1.5">
        <span className={`px-2 py-0.5 rounded-full font-medium ${
          plan.status === 'Completed' ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'
        }`}>
          {plan.status === 'Completed'
            ? `Payment Plan - Paid in Full (${plan.installmentCount})`
            : `Payment Plan - ${paidCount}/${plan.installmentCount} Paid ($${remaining.toFixed(2)} remaining)`}
        </span>
      </summary>
      <div className="mt-2 space-y-1.5">
        {plan.installments.map(inst => (
          <div key={inst.id} className="flex flex-wrap items-center justify-between gap-2 bg-zinc-800/40 border border-zinc-800 rounded-lg px-3 py-1.5">
            <div className="text-xs">
              <span className="text-gray-400">#{inst.sequence} - </span>
              <span className="font-medium">${inst.amount.toFixed(2)}</span>
              {inst.dueDate && <span className="text-gray-500"> - due {new Date(inst.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
            </div>
            <div className="flex items-center gap-1.5">
              {inst.paidAt ? (
                <span
                  className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-green-500/20 text-green-400"
                  title={inst.paidVia === 'square' ? 'Paid online via Square' : 'Marked paid manually'}
                >
                  Paid
                </span>
              ) : (
                <>
                  <InvoicePaymentActions
                    invoiceId={inst.id}
                    paymentLinkUrl={inst.paymentLinkUrl}
                    isPaid={false}
                    generateAction={generateLinkAction}
                    checkStatusAction={checkStatusAction}
                  />
                  <MarkPaidToggle invoiceId={inst.id} isPaid={false} action={toggleManualPaidAction} />
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </details>
  )
}

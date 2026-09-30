'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

type Installment = {
  id: string
  sequence: number
  amount: number
  due_date: string | null
  paid_at: string | null
  square_payment_link_url: string | null
  stripe_payment_link_url: string | null
}

type PlanRow = {
  id: string
  installment_count: number
  invoices: { invoice_number: string | null } | null
  invoice_installments: Installment[]
}

type OfferedInvoice = {
  id: string
  invoice_number: string | null
  amount: number
}

// Read-only progress view of any active payment plan on the customer's own
// invoices (see the "Allow payment plans" checkbox Jesse sets per customer,
// and app/invoices/page.tsx's "Split into Payments"/"Let Customer Choose")
// - lets a customer paying an invoice off in installments see exactly
// what's left and pay the next one whenever Jesse's generated its link,
// without having to ask. Also offers a chooser for any invoice Jesse has
// flagged as plan-eligible but left the schedule to the customer -
// installment_count/frequency here are only ever this customer's own
// choice, submitted to app/api/payment-plan/create which does the actual
// creation server-side (this component has no service-role access).
export default function PaymentPlanCard({ customerId }: { customerId: string }) {
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [offered, setOffered] = useState<OfferedInvoice[]>([])
  const [loaded, setLoaded] = useState(false)

  async function load() {
    const [{ data: planData }, { data: offeredData }] = await Promise.all([
      supabase
        .from('invoice_payment_plans')
        .select('id, installment_count, invoices!inner(invoice_number, customer_id), invoice_installments(id, sequence, amount, due_date, paid_at, square_payment_link_url, stripe_payment_link_url)')
        .eq('invoices.customer_id', customerId)
        .eq('status', 'Active'),
      supabase
        .from('invoices')
        .select('id, invoice_number, amount, invoice_payment_plans(id)')
        .eq('customer_id', customerId)
        .eq('payment_plan_offered', true)
        .is('paid_at', null),
    ])
    setPlans((planData as unknown as PlanRow[]) || [])
    // Only invoices with no plan row yet still need the chooser - one
    // that's already been set up (by either path) shows up in `plans`
    // above instead.
    const stillOffered = ((offeredData || []) as unknown as (OfferedInvoice & { invoice_payment_plans: { id: string }[] })[])
      .filter(inv => inv.invoice_payment_plans.length === 0)
      .map(({ id, invoice_number, amount }) => ({ id, invoice_number, amount: Number(amount) || 0 }))
    setOffered(stillOffered)
    setLoaded(true)
  }

  useEffect(() => {
    load()
  }, [customerId])

  if (!loaded || (plans.length === 0 && offered.length === 0)) return null

  return (
    <div className="space-y-3">
      {offered.map(inv => (
        <ChoosePlanCard key={inv.id} invoice={inv} onCreated={load} />
      ))}
      {plans.map(plan => {
        const installments = [...plan.invoice_installments].sort((a, b) => a.sequence - b.sequence)
        const paidCount = installments.filter(i => i.paid_at).length
        const remaining = installments.reduce((sum, i) => sum + (i.paid_at ? 0 : Number(i.amount)), 0)

        return (
          <div key={plan.id} className="bg-zinc-900 border border-blue-500/40 rounded-xl p-4 sm:p-6">
            <h3 className="text-sm font-semibold text-blue-400">
              Payment Plan{plan.invoices?.invoice_number ? ` - Invoice ${plan.invoices.invoice_number}` : ''}
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              {paidCount} of {plan.installment_count} payments made - ${remaining.toFixed(2)} remaining
            </p>
            <div className="mt-3 space-y-1.5">
              {installments.map(inst => (
                <div key={inst.id} className="flex items-center justify-between gap-2 bg-zinc-800/40 border border-zinc-800 rounded-lg px-3 py-2 text-sm">
                  <span>
                    #{inst.sequence} - ${Number(inst.amount).toFixed(2)}
                    {inst.due_date && (
                      <span className="text-gray-500"> - due {new Date(inst.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    )}
                  </span>
                  {inst.paid_at ? (
                    <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-green-500/20 text-green-400 shrink-0">Paid</span>
                  ) : (inst.stripe_payment_link_url || inst.square_payment_link_url) ? (
                    <a
                      href={(inst.stripe_payment_link_url || inst.square_payment_link_url) as string}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs bg-[#635bff] hover:bg-[#524ae0] text-white font-medium px-2.5 py-1 rounded-lg shrink-0"
                    >
                      Pay Now
                    </a>
                  ) : (
                    <span className="text-xs text-gray-600 shrink-0">Link not sent yet</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// The chooser itself - kept as its own component so submitting doesn't
// re-render the whole card list mid-request.
function ChoosePlanCard({ invoice, onCreated }: { invoice: OfferedInvoice; onCreated: () => void }) {
  const [installmentCount, setInstallmentCount] = useState('4')
  const [frequency, setFrequency] = useState('weekly')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    setError(null)
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/payment-plan/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: invoice.id, installment_count: Number(installmentCount), frequency }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body?.error || 'Could not set up the payment plan.')
        return
      }
      onCreated()
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const perInstallment = (Number(invoice.amount) || 0) / Number(installmentCount)

  return (
    <div className="bg-zinc-900 border border-orange-500/40 rounded-xl p-4 sm:p-6">
      <h3 className="text-sm font-semibold text-orange-400">
        Set Up a Payment Plan{invoice.invoice_number ? ` - Invoice ${invoice.invoice_number}` : ''}
      </h3>
      <p className="text-xs text-gray-500 mt-1">
        ${invoice.amount.toFixed(2)} total - choose how you'd like to pay it off.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Installments</label>
          <select
            value={installmentCount}
            onChange={e => setInstallmentCount(e.target.value)}
            className="text-sm bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5"
          >
            {[2, 3, 4, 6].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Frequency</label>
          <select
            value={frequency}
            onChange={e => setFrequency(e.target.value)}
            className="text-sm bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5"
          >
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every 2 Weeks</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="text-sm bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-medium px-3 py-1.5 rounded-lg"
        >
          {isSubmitting ? 'Setting Up...' : 'Set Up Plan'}
        </button>
      </div>
      <p className="text-xs text-gray-600 mt-2">
        ~${perInstallment.toFixed(2)} per payment, first one due today.
      </p>
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
    </div>
  )
}

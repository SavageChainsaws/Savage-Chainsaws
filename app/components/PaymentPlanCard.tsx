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
}

type PlanRow = {
  id: string
  installment_count: number
  invoices: { invoice_number: string | null } | null
  invoice_installments: Installment[]
}

// Read-only progress view of any active payment plan on the customer's own
// invoices (see the "Allow payment plans" checkbox Jesse sets per customer,
// and app/invoices/page.tsx's "Split into Payments") - lets a customer
// paying an invoice off in installments see exactly what's left and pay
// the next one whenever Jesse's generated its link, without having to ask.
export default function PaymentPlanCard({ customerId }: { customerId: string }) {
  const [plans, setPlans] = useState<PlanRow[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data } = await supabase
        .from('invoice_payment_plans')
        .select('id, installment_count, invoices!inner(invoice_number, customer_id), invoice_installments(id, sequence, amount, due_date, paid_at, square_payment_link_url)')
        .eq('invoices.customer_id', customerId)
        .eq('status', 'Active')
      if (!cancelled) setPlans((data as unknown as PlanRow[]) || [])
    }
    load()
    return () => { cancelled = true }
  }, [customerId])

  if (plans.length === 0) return null

  return (
    <div className="space-y-3">
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
                  ) : inst.square_payment_link_url ? (
                    <a
                      href={inst.square_payment_link_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs bg-[#006aff] hover:bg-[#0057d1] text-white font-medium px-2.5 py-1 rounded-lg shrink-0"
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

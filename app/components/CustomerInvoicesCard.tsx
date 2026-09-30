'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

type InvoiceRow = {
  id: string
  invoice_number: string | null
  amount: number
  paid_at: string | null
  pdf_url: string | null
  created_at: string
  units: { model: string | null; nickname: string | null; equipment_type: string | null } | null
}

// A customer previously had no way to find a past invoice again except
// digging up the original email - this is their own record of everything
// ever billed to them (unit-linked and standalone alike), split into what's
// still owed vs. already paid, so they can pull one up again for their own
// books/taxes without having to ask Jesse. Read-only: any actual payment
// action still lives on PaymentPlanCard or the invoice's own emailed Pay
// Now link, this is just the list + a link to each PDF. Self-fetches like
// PaymentPlanCard rather than threading through this page's already-huge
// server-side data fetch.
export default function CustomerInvoicesCard({ customerId }: { customerId: string }) {
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data } = await supabase
        .from('invoices')
        .select('id, invoice_number, amount, paid_at, pdf_url, created_at, units(model, nickname, equipment_type)')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
      if (!cancelled) setInvoices((data as unknown as InvoiceRow[]) || [])
    }
    load()
    return () => { cancelled = true }
  }, [customerId])

  if (invoices === null) return null

  const active = invoices.filter(i => !i.paid_at)
  const paid = invoices.filter(i => i.paid_at)

  function unitLabel(inv: InvoiceRow) {
    const u = inv.units
    if (!u) return null
    return u.nickname || [u.model, u.equipment_type].filter(Boolean).join(' - ') || null
  }

  function InvoiceRowItem({ inv }: { inv: InvoiceRow }) {
    const label = unitLabel(inv)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 bg-zinc-800/40 border border-zinc-800 rounded-lg px-3 py-2 text-sm">
        <div>
          <span className="font-medium">{inv.invoice_number || 'Invoice'}</span>
          <span className="text-gray-500"> - {new Date(inv.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
          {label && <span className="text-gray-500"> - {label}</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-medium">${Number(inv.amount).toFixed(2)}</span>
          {inv.paid_at ? (
            <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-green-500/20 text-green-400">Paid</span>
          ) : (
            <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-yellow-500/20 text-yellow-400">Unpaid</span>
          )}
          {inv.pdf_url && (
            <a
              href={inv.pdf_url}
              target="_blank"
              rel="noreferrer"
              className="text-xs border border-zinc-600 hover:border-orange-500 text-white font-medium px-2.5 py-1 rounded-lg transition"
            >
              View PDF
            </a>
          )}
        </div>
      </div>
    )
  }

  if (invoices.length === 0) return null

  return (
    <details className="bg-zinc-900 border border-zinc-800 border-l-4 border-l-orange-500 rounded-xl overflow-hidden group">
      <summary className="cursor-pointer list-none flex items-center justify-between px-4 sm:px-6 py-3 bg-orange-500/10 hover:bg-orange-500/20 transition">
        <h2 className="text-lg font-semibold text-orange-300">
          My Invoices ({invoices.length})
        </h2>
        <span className="text-orange-300/70 text-sm group-open:rotate-180 transition">v</span>
      </summary>
      <div className="border-t border-zinc-800 p-3 sm:p-4 space-y-4">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Active ({active.length})</p>
          {active.length === 0 ? (
            <p className="text-gray-500 text-sm">Nothing outstanding right now.</p>
          ) : (
            <div className="space-y-1.5">
              {active.map(inv => <InvoiceRowItem key={inv.id} inv={inv} />)}
            </div>
          )}
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Paid ({paid.length})</p>
          {paid.length === 0 ? (
            <p className="text-gray-500 text-sm">No paid invoices yet.</p>
          ) : (
            <div className="space-y-1.5">
              {paid.map(inv => <InvoiceRowItem key={inv.id} inv={inv} />)}
            </div>
          )}
        </div>
      </div>
    </details>
  )
}

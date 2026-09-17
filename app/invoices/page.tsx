import { getSessionInfo } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

// Admin-only running record of every invoice ever generated (per-unit and
// standalone), for the admin's own tax/bookkeeping use - a plain list
// pulled straight from the invoices table rather than having to open each
// unit individually. See app/api/invoice/route.ts and
// app/api/invoice/custom/route.ts for where these rows get written.
export default async function InvoicesPage() {
  const { supabase, user, isAdmin } = await getSessionInfo()
  if (!user || !isAdmin) redirect('/login')

  const { data: invoices } = await supabase
    .from('invoices')
    .select(
      'id, unit_id, customer_id, customer_name, invoice_number, amount, description, status, pdf_url, created_at, units(invoice_url, model, nickname, customers(name)), customers(name)'
    )
    .order('created_at', { ascending: false })

  const rows = (invoices || []).map(inv => {
    const unitCustomerName = (inv.units as unknown as { customers?: { name?: string } | null } | null)?.customers?.name
    const directCustomerName = (inv.customers as unknown as { name?: string } | null)?.name
    const displayName = inv.customer_name || directCustomerName || unitCustomerName || 'Unknown customer'
    const pdfUrl = inv.pdf_url || (inv.units as unknown as { invoice_url?: string } | null)?.invoice_url || null
    const unitLabel = (inv.units as unknown as { model?: string; nickname?: string } | null)
    return {
      id: inv.id as string,
      date: inv.created_at as string,
      invoiceNumber: (inv.invoice_number as string) || (inv.description as string) || '—',
      customerName: displayName,
      amount: Number(inv.amount) || 0,
      status: (inv.status as string) || 'sent',
      pdfUrl,
      unitId: inv.unit_id as string | null,
      unitLabel: unitLabel?.nickname || unitLabel?.model || null,
    }
  })

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const totalThisMonth = rows
    .filter(r => new Date(r.date) >= monthStart)
    .reduce((sum, r) => sum + r.amount, 0)
  const totalAllTime = rows.reduce((sum, r) => sum + r.amount, 0)

  return (
    <main className="min-h-screen bg-zinc-950 text-white p-4 sm:p-6 md:p-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/images/logo.png" alt="" className="h-10 w-10 object-contain" />
            <div>
              <h1 className="text-2xl font-bold">
                SAVAGE <span className="text-orange-500">CHAINSAWS</span>
              </h1>
              <p className="text-sm text-gray-400">All Invoices</p>
            </div>
          </div>
          <Link
            href="/"
            className="border border-zinc-700 hover:border-orange-500 text-sm px-4 py-2 rounded-lg transition"
          >
            ← Back to Dashboard
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase">Invoiced this month</p>
            <p className="text-3xl font-bold text-orange-400">${totalThisMonth.toFixed(2)}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase">Invoiced all-time</p>
            <p className="text-3xl font-bold text-white">${totalAllTime.toFixed(2)}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase">Total invoices</p>
            <p className="text-3xl font-bold text-white">{rows.length}</p>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-zinc-800">
            <h2 className="text-lg font-semibold text-orange-400">Every invoice generated</h2>
            <p className="text-xs text-gray-500 mt-1">Most recent first - for your own tax/bookkeeping records.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-zinc-800">
                  <th className="px-4 sm:px-6 py-3">Date</th>
                  <th className="px-3 py-3">Invoice #</th>
                  <th className="px-3 py-3">Customer</th>
                  <th className="px-3 py-3">Unit</th>
                  <th className="px-3 py-3 text-right">Total</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-zinc-800/40">
                    <td className="px-4 sm:px-6 py-3 text-gray-300 whitespace-nowrap">
                      {new Date(r.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </td>
                    <td className="px-3 py-3 text-gray-300 whitespace-nowrap">{r.invoiceNumber}</td>
                    <td className="px-3 py-3 font-medium">{r.customerName}</td>
                    <td className="px-3 py-3 text-gray-400">{r.unitLabel || '—'}</td>
                    <td className="px-3 py-3 text-right font-bold text-orange-400">${r.amount.toFixed(2)}</td>
                    <td className="px-3 py-3 text-gray-400 capitalize">{r.status}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {r.pdfUrl ? (
                        <a
                          href={r.pdfUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-orange-400 hover:text-orange-300"
                        >
                          View PDF →
                        </a>
                      ) : (
                        <span className="text-xs text-gray-600">No PDF saved</span>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-gray-500 text-center">
                      No invoices generated yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  )
}

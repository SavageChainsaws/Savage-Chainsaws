type PanelInvoice = {
  id: string
  invoice_number: string | null
  amount: number
  paid_at: string | null
  pdf_url: string | null
  created_at: string
  unit_id: string | null
}

type PanelUnit = {
  id: string
  nickname: string | null
  model: string | null
  equipment_type: string | null
}

// Shared renderer for the customer portal's Active Invoices and Archive
// panels - same layout and columns either way, just a different source
// list and copy.
export default function InvoiceListPanel({
  invoices,
  units,
  mode,
}: {
  invoices: PanelInvoice[]
  units: PanelUnit[]
  mode: 'active' | 'archived'
}) {
  function invoiceUnitLabel(inv: PanelInvoice) {
    const u = inv.unit_id ? units.find(u => u.id === inv.unit_id) : null
    if (!u) return null
    return u.nickname || [u.model, u.equipment_type].filter(Boolean).join(' - ') || null
  }

  const list = mode === 'active' ? invoices.filter(i => !i.paid_at) : invoices.filter(i => i.paid_at)

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-4 sm:px-6 py-3 border-b border-zinc-800">
        <h2 className="text-lg font-semibold text-orange-400">
          {mode === 'active' ? 'Active Invoices' : 'Archive'}
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          {mode === 'active'
            ? 'Anything still unpaid, most recent first.'
            : 'Your paid invoice history, for your own records/taxes.'}
        </p>
      </div>
      <div className="p-3 sm:p-4 space-y-1.5">
        {list.length === 0 ? (
          <p className="text-gray-500 text-sm px-1">
            {mode === 'active' ? "You're all caught up - nothing outstanding." : 'No paid invoices yet.'}
          </p>
        ) : (
          list.map(inv => {
            const label = invoiceUnitLabel(inv)
            return (
              <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 bg-zinc-800/40 border border-zinc-800 rounded-lg px-3 py-2 text-sm">
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
          })
        )}
      </div>
    </div>
  )
}

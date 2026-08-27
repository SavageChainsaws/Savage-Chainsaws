import { getSessionInfo } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function ReportsPage() {
  const { supabase, user, isAdmin } = await getSessionInfo()
  if (!user || !isAdmin) redirect('/login')

  const { data: customers } = await supabase.from('customers').select('id, name').order('name')
  const { data: units } = await supabase
    .from('units')
    .select('id, customer_id, status, created_at, last_service_date, is_priority')
  const { data: feedback } = await supabase
    .from('feedback')
    .select('id, seen, type, created_at')
    .order('created_at', { ascending: false })

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const byCustomer = (customers || [])
    .map(c => {
      const theirUnits = (units || []).filter(u => u.customer_id === c.id)
      const thisMonth = theirUnits.filter(u => new Date(u.created_at) >= monthStart).length
      const total = theirUnits.length
      const active = theirUnits.filter(
        u => !['Completed', 'Fleet', 'Registered'].includes(u.status)
      ).length
      const completed = theirUnits.filter(
        u => u.status === 'Completed' || u.status === 'Ready for Pickup'
      ).length
      return { ...c, total, thisMonth, active, completed }
    })
    .sort((a, b) => b.thisMonth - a.thisMonth || b.total - a.total)

  const dueSoon = (units || []).filter(u => {
    if (!u.last_service_date) return false
    const last = new Date(u.last_service_date)
    const days = Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24))
    return days >= 90
  }).length

  const unreadFeedback = (feedback || []).filter(f => !f.seen).length
  const totalThisMonth = (units || []).filter(u => new Date(u.created_at) >= monthStart).length
  const totalUnits = (units || []).length

  return (
    <main className="min-h-screen bg-zinc-950 text-white p-4 sm:p-6 md:p-10">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/images/logo.png" alt="" className="h-10 w-10 object-contain" />
            <div>
              <h1 className="text-2xl font-bold">
                SAVAGE <span className="text-orange-500">CHAINSAWS</span>
              </h1>
              <p className="text-sm text-gray-400">Business Reports</p>
            </div>
          </div>
          <Link
            href="/"
            className="border border-zinc-700 hover:border-orange-500 text-sm px-4 py-2 rounded-lg transition"
          >
            ← Back to Dashboard
          </Link>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase">Units this month</p>
            <p className="text-3xl font-bold text-orange-400">{totalThisMonth}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase">All units tracked</p>
            <p className="text-3xl font-bold text-white">{totalUnits}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase">Due for service (90d+)</p>
            <p className="text-3xl font-bold text-red-400">{dueSoon}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase">Unread messages</p>
            <p className="text-3xl font-bold text-yellow-400">{unreadFeedback}</p>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-zinc-800">
            <h2 className="text-lg font-semibold text-orange-400">Customers by volume</h2>
            <p className="text-xs text-gray-500 mt-1">
              Sorted by units this month — use for incentives (e.g. free tune-up at 15+)
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-zinc-800">
                  <th className="px-4 sm:px-6 py-3">Customer</th>
                  <th className="px-3 py-3 text-right">This month</th>
                  <th className="px-3 py-3 text-right">Total</th>
                  <th className="px-3 py-3 text-right">Active</th>
                  <th className="px-3 py-3 text-right">Completed</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {byCustomer.map(c => (
                  <tr key={c.id} className="hover:bg-zinc-800/40">
                    <td className="px-4 sm:px-6 py-3 font-medium">{c.name}</td>
                    <td className="px-3 py-3 text-right">
                      <span
                        className={
                          c.thisMonth >= 15
                            ? 'text-green-400 font-bold'
                            : c.thisMonth > 0
                            ? 'text-orange-400'
                            : 'text-gray-500'
                        }
                      >
                        {c.thisMonth}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right text-gray-300">{c.total}</td>
                    <td className="px-3 py-3 text-right text-blue-400">{c.active}</td>
                    <td className="px-3 py-3 text-right text-green-400">{c.completed}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/?customer=${c.id}`}
                        className="text-xs text-orange-400 hover:text-orange-300"
                      >
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
                {byCustomer.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-gray-500 text-center">
                      No customers yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-xs text-gray-500">
          Green month count (15+) = incentive threshold idea. Adjust later when you set promo rules.
        </p>
      </div>
    </main>
  )
}
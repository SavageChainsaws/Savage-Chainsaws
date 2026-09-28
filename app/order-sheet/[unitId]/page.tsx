import { getSessionInfo } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { unitLabel } from '@/lib/units'
import PrintButton from '../../components/PrintButton'

// Standalone printable view of a unit's Order Sheet (see
// UnitOrderSheetSection / addOrderSheetItem in app/page.tsx) - a running
// list of STIHL parts pasted in during diagnosis, meant to be printed and
// taken to the parts store. Deliberately its own route rather than a modal
// so it opens cleanly in a new tab and prints without the dashboard chrome.
export default async function OrderSheetPage({
  params,
}: {
  params: Promise<{ unitId: string }>
}) {
  const { unitId } = await params
  const { supabase, user, isAdmin } = await getSessionInfo()
  if (!user || !isAdmin) redirect('/login')

  const { data: unit } = await supabase
    .from('units')
    .select('id, model, equipment_type, nickname, serial_number, customer_id')
    .eq('id', unitId)
    .maybeSingle()
  if (!unit) notFound()

  const { data: customer } = unit.customer_id
    ? await supabase.from('customers').select('name').eq('id', unit.customer_id).maybeSingle()
    : { data: null }

  const { data: items } = await supabase
    .from('order_sheet_items')
    .select('*')
    .eq('unit_id', unitId)
    .order('created_at')

  const totalCost = (items || []).reduce((sum, i) => sum + (Number(i.cost) || 0) * i.quantity, 0)
  const totalRetail = (items || []).reduce((sum, i) => sum + (Number(i.retail_price) || 0) * i.quantity, 0)

  return (
    <main className="min-h-screen bg-white text-black p-6 sm:p-10 print:p-0">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between print:hidden">
          <Link href="/" className="text-sm text-gray-600 hover:text-black">{'<-'} Back to Dashboard</Link>
          <PrintButton />
        </div>

        <div className="border-b border-black pb-3">
          <h1 className="text-xl font-bold">SAVAGE CHAINSAWS - Order Sheet</h1>
          <p className="text-sm text-gray-700 mt-1">
            {unitLabel(unit)}
            {unit.nickname ? ` - ${unit.nickname}` : ''}
            {unit.serial_number ? ` (SN: ${unit.serial_number})` : ''}
          </p>
          {customer?.name && <p className="text-sm text-gray-700">Customer: {customer.name}</p>}
          <p className="text-xs text-gray-500 mt-1">Printed {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
        </div>

        {(!items || items.length === 0) ? (
          <p className="text-sm text-gray-600">No parts on this order sheet yet.</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left border-b-2 border-black">
                <th className="py-2 pr-3">SKU</th>
                <th className="py-2 pr-3">Description</th>
                <th className="py-2 pr-3 text-right">Qty</th>
                <th className="py-2 pr-3 text-right">Cost</th>
                <th className="py-2 text-right">Retail</th>
              </tr>
            </thead>
            <tbody>
              {items.map(i => (
                <tr key={i.id} className="border-b border-gray-300">
                  <td className="py-2 pr-3 font-mono">{i.sku}</td>
                  <td className="py-2 pr-3">{i.description}</td>
                  <td className="py-2 pr-3 text-right">{i.quantity}</td>
                  <td className="py-2 pr-3 text-right">{i.cost != null ? `$${(Number(i.cost) * i.quantity).toFixed(2)}` : '-'}</td>
                  <td className="py-2 text-right">{i.retail_price != null ? `$${(Number(i.retail_price) * i.quantity).toFixed(2)}` : '-'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-black font-semibold">
                <td className="py-2 pr-3" colSpan={3}>Total</td>
                <td className="py-2 pr-3 text-right">${totalCost.toFixed(2)}</td>
                <td className="py-2 text-right">${totalRetail.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </main>
  )
}

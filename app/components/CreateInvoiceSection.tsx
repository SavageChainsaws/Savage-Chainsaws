import CreateUnitInvoiceForm from './CreateUnitInvoiceForm'
import { resolveUnitParts } from '@/lib/parts'
import { PRIORITY_FEE } from '@/lib/units'

type ServiceHistoryEntry = { unit_id: string; cost: number | null }
type OrderSheetItem = { unit_id: string; description: string; sku: string; retail_price: number | null; quantity: number }

export default function CreateInvoiceSection({
  unit,
  customers,
  modelPartsAll,
  unitOverridesAll,
  serviceHistoryAll,
  orderSheetItemsAll,
  defaultTaxRatePercent,
}: {
  unit: { id: string; customer_id: string | null; model: string | null; is_priority: boolean | null }
  customers: { id: string; payment_plans_enabled?: boolean }[]
  modelPartsAll: unknown[]
  unitOverridesAll: unknown[]
  serviceHistoryAll: ServiceHistoryEntry[]
  orderSheetItemsAll: OrderSheetItem[]
  defaultTaxRatePercent: number
}) {
  const unitCustomer = customers.find(c => c.id === unit.customer_id)
  const parts = resolveUnitParts(unit, modelPartsAll, unitOverridesAll)
  const history = serviceHistoryAll.filter(e => e.unit_id === unit.id)
  const latestCost = history[0]?.cost ?? ''
  const orderSheetItems = orderSheetItemsAll.filter(i => i.unit_id === unit.id)
  // Retail price is what the customer pays - cost stays Order-Sheet-only,
  // for Jesse's own reference when he's at the store buying the parts.
  const defaultPartsItems = orderSheetItems.map(i => ({
    description: `${i.description} (${i.sku})`,
    price: (Number(i.retail_price) || 0).toFixed(2),
    quantity: String(i.quantity),
  }))
  return (
    <details className="group/invoice-panel">
      <summary className="inline-flex items-center gap-1.5 cursor-pointer list-none select-none bg-orange-600 hover:bg-orange-500 text-white text-sm px-4 py-1.5 rounded-lg">
        Create Invoice
        <span className="text-xs group-open/invoice-panel:rotate-180 transition">v</span>
      </summary>
      {/* id lives on this inner, closed-by-default div (not the <details>
          itself) - a <details>'s own visibility never depends on its open
          state (the summary always shows), so a fragment link targeting
          the <details> tag directly doesn't qualify for the browser's
          auto-open-closed-ancestor-details behavior and just scrolls to
          the still-collapsed header. Targeting genuinely hidden content
          instead makes the browser open this <details> for us - see the
          "Generate Invoice from Order Sheet" link in
          UnitOrderSheetSection. */}
      <div id={`create-invoice-${unit.id}`} className="w-full mt-2">
        <CreateUnitInvoiceForm
          unitId={unit.id}
          defaultLaborPrice={latestCost}
          defaultPriorityFee={unit.is_priority ? PRIORITY_FEE : ''}
          defaultTaxRatePercent={defaultTaxRatePercent}
          defaultPartsItems={defaultPartsItems}
          customerPaymentPlansEnabled={!!unitCustomer?.payment_plans_enabled}
        />
        <p className="text-xs text-gray-600 mt-1.5">
          {orderSheetItems.length > 0
            ? `${orderSheetItems.length} part${orderSheetItems.length === 1 ? '' : 's'} loaded from the Order Sheet at retail price - just add labor below.`
            : parts.length > 0
            ? `${parts.length} part${parts.length === 1 ? '' : 's'} on file for this model - add them to Parts above if used on this job.`
            : 'No parts on file for this unit - the invoice will still generate.'}
        </p>
      </div>
    </details>
  )
}

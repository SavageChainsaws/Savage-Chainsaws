import Link from 'next/link'
import UppercaseInput from './UppercaseInput'
import {
  addOrderSheetItem,
  updateOrderSheetItemQuantity,
  deleteOrderSheetItem,
  clearOrderSheet,
} from '../actions/orderSheet'

type OrderSheetItem = {
  id: string
  unit_id: string
  sku: string
  description: string
  quantity: number
  retail_price: number | null
}

// Order Sheet - paste a SKU from STIHL's dealer parts catalog, it
// auto-fills from parts_catalog (real distributor pricing), and the
// running list can be printed via /order-sheet/[unitId] to take to the
// store.
export default function UnitOrderSheetSection({
  unit,
  orderSheetItemsAll,
}: {
  unit: { id: string }
  orderSheetItemsAll: OrderSheetItem[]
}) {
  const items = orderSheetItemsAll.filter(i => i.unit_id === unit.id)
  const totalRetail = items.reduce((sum, i) => sum + (Number(i.retail_price) || 0) * i.quantity, 0)
  return (
    <details className="mt-3 border-t border-zinc-800 pt-2.5 group/order-sheet-panel">
      <summary className="inline-flex items-center gap-1.5 cursor-pointer list-none select-none bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-1.5 rounded-lg mb-2">
        Order Sheet{items.length > 0 ? ` (${items.length})` : ''}
        <span className="text-xs group-open/order-sheet-panel:rotate-180 transition">v</span>
      </summary>
      {items.length === 0 ? (
        <p className="text-xs text-gray-500 mb-2">No parts added yet - paste a SKU below as you diagnose.</p>
      ) : (
        <div className="space-y-1.5 mb-2">
          {items.map(i => (
            <div key={i.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-orange-300">{i.sku}</span>
              <span className="text-gray-300 flex-1 min-w-[120px]">{i.description}</span>
              <form action={updateOrderSheetItemQuantity} className="flex items-center gap-1">
                <input type="hidden" name="id" value={i.id} />
                <label className="text-xs text-gray-500">Qty</label>
                <input
                  name="quantity"
                  type="number"
                  min={1}
                  defaultValue={i.quantity}
                  className="w-14 bg-zinc-800 border border-zinc-700 rounded-lg px-1.5 py-0.5 text-xs"
                />
                <button type="submit" className="text-xs text-orange-400 hover:text-orange-300">Save</button>
              </form>
              <span className="text-xs text-gray-400 w-16 text-right">
                {i.retail_price != null ? `$${Number(i.retail_price).toFixed(2)}` : '-'}
              </span>
              <form action={deleteOrderSheetItem}>
                <input type="hidden" name="id" value={i.id} />
                <button type="submit" className="text-xs text-red-400 hover:text-red-300">Remove</button>
              </form>
            </div>
          ))}
          <p className="text-xs text-gray-500 pt-1">Estimated retail total: ${totalRetail.toFixed(2)}</p>
        </div>
      )}
      {/* key={items.length} forces a remount after each successful Add, so
          the uncontrolled SKU/quantity inputs reset to empty - otherwise
          React reconciles the same DOM nodes across the revalidatePath
          re-render and leaves the typed SKU sitting in the field. */}
      <form key={items.length} action={addOrderSheetItem} className="flex flex-wrap gap-2 mb-2">
        <input type="hidden" name="unit_id" value={unit.id} />
        <UppercaseInput
          name="sku"
          placeholder="Paste SKU from Steele's/STIHL catalog"
          className="flex-1 min-w-[160px] font-mono bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
        />
        <input
          name="quantity"
          type="number"
          min={1}
          defaultValue={1}
          className="w-16 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm"
        />
        <button type="submit" className="text-xs bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded-lg">
          Add
        </button>
      </form>
      {items.length > 0 && (
        // Jumps to CreateInvoiceSection's <details> (see its matching id) -
        // browsers auto-expand a closed <details> you link to (the HTML
        // "reveal" algorithm), so this needs no client JS to both open it
        // and scroll it into view, already pre-filled with these same
        // Order Sheet parts at retail price.
        <a
          href={`#create-invoice-${unit.id}`}
          className="inline-flex items-center gap-1.5 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-1.5 rounded-lg mb-2"
        >
          Generate Invoice from Order Sheet {'->'}
        </a>
      )}
      <div className="flex gap-3">
        {items.length > 0 && (
          <Link
            href={`/order-sheet/${unit.id}`}
            target="_blank"
            className="text-xs text-orange-400 hover:text-orange-300"
          >
            Print Order Sheet {'->'}
          </Link>
        )}
        {items.length > 0 && (
          <form action={clearOrderSheet}>
            <input type="hidden" name="unit_id" value={unit.id} />
            <button type="submit" className="text-xs text-gray-500 hover:text-red-400">Clear list</button>
          </form>
        )}
      </div>
    </details>
  )
}

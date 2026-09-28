'use client'

import { useState, useRef, useEffect } from 'react'
import { parseSKUInput, calculateLineItemTotals, calculateOrderSheetTotals, formatCurrency, type OrderSheetLineItem, type Part } from '@/lib/parts'

interface PartOrderSheetProps {
  unitId: string
  model: string
}

export default function PartOrderSheet({ unitId, model }: PartOrderSheetProps) {
  const [expanded, setExpanded] = useState(false)
  const [skuInput, setSkuInput] = useState('')
  const [lineItems, setLineItems] = useState<OrderSheetLineItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [partsData, setPartsData] = useState<Map<string, Part> | null>(null)
  const [quantity, setQuantity] = useState('1')
  const printRef = useRef<HTMLDivElement>(null)

  // Load parts catalog on component mount
  useEffect(() => {
    const loadPartsData = async () => {
      try {
        const response = await fetch('/api/parts/catalog')
        if (response.ok) {
          const data = await response.json()
          const partMap = new Map(data.parts.map((p: Part) => [p.sku, p]))
          setPartsData(partMap)
        }
      } catch (error) {
        console.error('Failed to load parts catalog:', error)
      }
    }
    loadPartsData()
  }, [])

  async function handleAddSKU(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!skuInput.trim()) return

    setLoading(true)
    try {
      // Parse multiple SKUs
      const skus = parseSKUInput(skuInput)
      const qtyNum = Math.max(1, parseInt(quantity) || 1)

      // Fetch part info for each SKU
      const response = await fetch('/api/parts/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skus }),
      })

      if (!response.ok) throw new Error('Failed to look up parts')
      const result = await response.json()

      // Add found parts as line items
      const newItems = result.found.map((part: Part, idx: number) => {
        const item = {
          id: `${Date.now()}-${idx}`,
          sku: part.sku,
          description: part.description,
          quantity: qtyNum,
          unit_cost: part.cost,
          unit_retail: part.retail_price,
        }
        return calculateLineItemTotals(item)
      })

      setLineItems([...lineItems, ...newItems])

      // Show any not found
      if (result.notFound.length > 0) {
        setError(`SKUs not found: ${result.notFound.join(', ')}`)
      }

      setSkuInput('')
      setQuantity('1')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to add parts')
    } finally {
      setLoading(false)
    }
  }

  function handleRemoveItem(id: string) {
    setLineItems(lineItems.filter((item) => item.id !== id))
  }

  function handleUpdateQuantity(id: string, newQty: number) {
    setLineItems(
      lineItems.map((item) =>
        item.id === id
          ? calculateLineItemTotals({ ...item, quantity: Math.max(1, newQty) })
          : item
      )
    )
  }

  function handlePrint() {
    if (printRef.current) {
      const printWindow = window.open('', '_blank')
      if (printWindow) {
        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Order Sheet - ${model}</title>
              <style>
                body { font-family: Arial, sans-serif; margin: 20px; background: white; color: black; }
                h1 { margin: 0 0 10px 0; font-size: 24px; }
                .header { margin-bottom: 20px; }
                .header p { margin: 0; font-size: 14px; }
                table { width: 100%; border-collapse: collapse; margin-top: 15px; }
                th { background: #333; color: white; padding: 10px; text-align: left; font-weight: bold; }
                td { padding: 10px; border-bottom: 1px solid #ddd; }
                tr:nth-child(even) { background: #f9f9f9; }
                .number { text-align: right; }
                .totals { margin-top: 20px; text-align: right; font-weight: bold; }
                .footer { margin-top: 30px; font-size: 12px; color: #666; }
              </style>
            </head>
            <body>
              ${printRef.current?.innerHTML || ''}
              <div class="footer">
                <p>Printed on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</p>
              </div>
            </body>
          </html>
        `)
        printWindow.document.close()
        printWindow.print()
      }
    }
  }

  const totals = calculateOrderSheetTotals(lineItems)

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full text-left bg-green-500/10 border border-green-500/30 hover:border-green-500/50 rounded-lg px-4 py-3 text-sm text-green-300 hover:text-green-200 transition"
      >
        + Order Sheet / Parts List
      </button>
    )
  }

  return (
    <div className="border border-green-500/30 rounded-lg bg-green-500/[0.03] p-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold text-green-300">Order Sheet for {model}</h3>
        <button
          onClick={() => setExpanded(false)}
          className="text-xs text-gray-400 hover:text-gray-200"
        >
          Hide
        </button>
      </div>

      {/* SKU Input Form */}
      <form onSubmit={handleAddSKU} className="bg-zinc-900 border border-green-500/20 rounded-lg p-3 space-y-2">
        <label className="text-xs font-medium text-green-300">Add Parts by SKU</label>
        <p className="text-xs text-gray-500">
          Paste SKU numbers (comma or space-separated, or one per line)
        </p>
        <textarea
          value={skuInput}
          onChange={(e) => setSkuInput(e.target.value)}
          placeholder="e.g. 123456, 789012&#10;or paste multiple SKUs"
          className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-green-500 font-mono"
          rows={2}
        />
        <div className="flex gap-2">
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            min="1"
            className="w-16 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-green-500"
            placeholder="Qty"
          />
          <button
            type="submit"
            disabled={loading || !skuInput.trim()}
            className="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-xs font-medium py-1.5 rounded transition"
          >
            {loading ? 'Adding...' : 'Add to Order Sheet'}
          </button>
        </div>
        {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">{error}</p>}
      </form>

      {/* Order Sheet Table */}
      {lineItems.length > 0 ? (
        <>
          <div ref={printRef} className="space-y-3">
            <div className="text-center pb-2 border-b border-green-500/30">
              <p className="font-bold text-green-300">ORDER SHEET</p>
              <p className="text-xs text-gray-400">{model}</p>
              <p className="text-xs text-gray-500">{new Date().toLocaleDateString()}</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-green-500/30 text-green-300">
                    <th className="text-left py-1 px-1 font-semibold">SKU</th>
                    <th className="text-left py-1 px-1 font-semibold">Description</th>
                    <th className="text-center py-1 px-1 font-semibold w-12">Qty</th>
                    <th className="text-right py-1 px-1 font-semibold">Cost</th>
                    <th className="text-right py-1 px-1 font-semibold">Retail</th>
                    <th className="text-right py-1 px-1 font-semibold">Total Cost</th>
                    <th className="text-center py-1 px-1 w-6"></th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((item) => (
                    <tr key={item.id} className="border-b border-zinc-700 hover:bg-green-500/5">
                      <td className="py-1 px-1 text-green-200 font-mono">{item.sku}</td>
                      <td className="py-1 px-1 text-gray-300">{item.description}</td>
                      <td className="text-center py-1 px-1">
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => handleUpdateQuantity(item.id, parseInt(e.target.value))}
                          min="1"
                          className="w-10 bg-zinc-800 border border-zinc-600 rounded px-1 py-0.5 text-xs text-white focus:outline-none focus:border-green-500 text-center"
                        />
                      </td>
                      <td className="text-right py-1 px-1 text-gray-300">{formatCurrency(item.unit_cost)}</td>
                      <td className="text-right py-1 px-1 text-gray-300">{formatCurrency(item.unit_retail)}</td>
                      <td className="text-right py-1 px-1 text-green-200 font-medium">{formatCurrency(item.line_total_cost)}</td>
                      <td className="text-center py-1 px-1">
                        <button
                          onClick={() => handleRemoveItem(item.id)}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-green-500/10 border border-green-500/30 rounded p-2 space-y-1">
              <div className="flex justify-between text-xs text-gray-300">
                <span>Items:</span>
                <span className="font-medium">{totals.item_count}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-300">
                <span>Total Quantity:</span>
                <span className="font-medium">{totals.total_quantity}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-300 border-t border-green-500/20 pt-1">
                <span>Total Cost:</span>
                <span className="font-medium text-green-300">{formatCurrency(totals.total_cost)}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-300">
                <span>Total Retail:</span>
                <span className="font-medium text-orange-300">{formatCurrency(totals.total_retail)}</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <button
              onClick={handlePrint}
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium py-1.5 rounded transition"
            >
              🖨️ Print Order Sheet
            </button>
            <button
              onClick={() => setLineItems([])}
              className="flex-1 bg-red-600/30 hover:bg-red-600/50 text-red-300 hover:text-red-200 text-xs font-medium py-1.5 rounded transition"
            >
              Clear All
            </button>
          </div>
        </>
      ) : (
        <div className="bg-green-500/10 border border-green-500/30 rounded p-3 text-center text-xs text-gray-400">
          No parts added yet. Paste SKU numbers above to get started.
        </div>
      )}
    </div>
  )
}

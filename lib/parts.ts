// Shared parts/SKU resolution logic used by both the admin dashboard
// (per-unit parts section) and the reports page (parts-usage breakdown),
// so the two never drift out of sync.

export type ResolvedPart = {
  id: string
  part_name: string
  sku: string
  sku_type: 'OEM' | 'Aftermarket'
  isOverride: boolean
  hasDefault: boolean
}

// Parts pricing catalog (from Excel source data)
export interface Part {
  sku: string
  description: string
  cost: number
  retail_price: number
  category?: string
}

// Order sheet line item
export interface OrderSheetLineItem {
  id: string // Random ID for tracking
  sku: string
  description: string
  quantity: number
  unit_cost: number
  unit_retail: number
  line_total_cost: number
  line_total_retail: number
}

// Unit order sheet
export interface UnitOrderSheet {
  id: string
  unit_id: string
  model: string
  created_at: string
  updated_at: string
  line_items: OrderSheetLineItem[]
}

export function normalizeModelKey(model: string | null): string {
  return (model || '').toUpperCase().replace(/\s+/g, '')
}

// Merges a unit's model-level default parts with any unit-specific
// overrides. Matching is by normalized model/part-name key (mirrors the
// DB's generated model_key/part_name_key columns) so casing/spacing
// differences in how a model was typed don't split one physical model
// into separate part sets. A unit override always wins over its model
// default; an override with no matching model default still shows, as a
// part unique to that one unit.
export function resolveUnitParts(
  unit: { id: string; model: string | null },
  modelPartsAll: any[],
  unitOverridesAll: any[]
): ResolvedPart[] {
  const modelKey = normalizeModelKey(unit.model)
  const defaults = modelPartsAll.filter(p => p.model_key === modelKey)
  const overrides = unitOverridesAll.filter(o => o.unit_id === unit.id)
  const overrideByKey = new Map(overrides.map(o => [o.part_name_key, o]))

  const resolved: ResolvedPart[] = []
  for (const d of defaults) {
    const override = overrideByKey.get(d.part_name_key)
    resolved.push({
      id: override ? override.id : d.id,
      part_name: override ? override.part_name : d.part_name,
      sku: override ? override.sku : d.sku,
      sku_type: override ? override.sku_type : d.sku_type,
      isOverride: !!override,
      hasDefault: true,
    })
  }
  const defaultKeys = new Set(defaults.map(d => d.part_name_key))
  for (const o of overrides) {
    if (defaultKeys.has(o.part_name_key)) continue
    resolved.push({
      id: o.id,
      part_name: o.part_name,
      sku: o.sku,
      sku_type: o.sku_type,
      isOverride: true,
      hasDefault: false,
    })
  }
  return resolved.sort((a, b) => a.part_name.localeCompare(b.part_name))
}

// Order sheet utilities

// Calculate line item totals
export function calculateLineItemTotals(item: Omit<OrderSheetLineItem, 'line_total_cost' | 'line_total_retail'>): OrderSheetLineItem {
  return {
    ...item,
    line_total_cost: item.unit_cost * item.quantity,
    line_total_retail: item.unit_retail * item.quantity,
  }
}

// Calculate order sheet totals
export function calculateOrderSheetTotals(items: OrderSheetLineItem[]) {
  return {
    total_cost: items.reduce((sum, item) => sum + item.line_total_cost, 0),
    total_retail: items.reduce((sum, item) => sum + item.line_total_retail, 0),
    item_count: items.length,
    total_quantity: items.reduce((sum, item) => sum + item.quantity, 0),
  }
}

// Parse SKU input (supports multiple formats: comma, newline, space-separated)
export function parseSKUInput(input: string): string[] {
  return input
    .split(/[\s,]+/)
    .map((sku) => sku.trim().toUpperCase())
    .filter((sku) => sku.length > 0)
}

// Format currency
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value)
}

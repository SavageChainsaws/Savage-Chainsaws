// Shared with app/page.tsx (admin dashboard) and the push-notification API
// route, which both need to describe a unit the same way without importing
// from inside a page component.

// Model - Type first - never lead with serial
export function unitLabel(unit: { model?: string | null; equipment_type?: string | null; nickname?: string | null; serial_number?: string | null }) {
  const model = (unit.model || '').trim()
  const type = (unit.equipment_type || '').trim()
  if (model && type) return `${model} - ${type}`
  if (model) return model
  if (type) return type
  return unit.nickname || unit.serial_number || 'No model'
}

export function isUnderWarranty(unit: { warranty_end: string | null }): boolean {
  if (!unit.warranty_end) return false
  const today = new Date().toISOString().slice(0, 10)
  return unit.warranty_end >= today
}

// Fleet Units list color coding - previously a private closure in
// app/page.tsx (admin-only; the customer portal has no equivalent).
export function getFleetColor(unit: { status: string; last_service_date: string | null; purchase_date: string | null }): 'red' | 'green' | 'orange' {
  const threeMonthsAgo = new Date()
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
  const lastService = unit.last_service_date ? new Date(unit.last_service_date) : null
  const purchase = unit.purchase_date ? new Date(unit.purchase_date) : null
  const reference = lastService || purchase
  if (unit.status === 'Ready for Pickup' || lastService) {
    if (reference && reference < threeMonthsAgo) return 'red'
    return 'green'
  }
  if (reference && reference < threeMonthsAgo) return 'red'
  return 'orange'
}

export function equipmentGroup(type: string | null): number {
  if (!type) return 3
  const t = type.toLowerCase()
  if (t.includes('riding') || (t.includes('mower') && !t.includes('walk'))) return 1
  if (t.includes('chainsaw') || t.includes('pole') || t.includes('cutquik') || t.includes('hedge')) return 2
  return 3
}

export function groupLabel(n: number) {
  if (n === 1) return 'Riding Mowers'
  if (n === 2) return 'Chainsaws / Handheld'
  return 'Trimmers & Misc'
}

// Appends a history-log line, newest first - shared by every admin action
// that stamps a unit's audit trail (status changes, picked-up, etc.).
export function stampHistory(existing: string | null, entry: string) {
  const line = `${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} - ${entry}`
  return existing ? `${line}\n${existing}` : line
}

// Placeholder text customers/admin type when the real serial isn't known.
// Never used to match an existing fleet unit - several different physical
// units can share the same placeholder, so matching on it would silently
// merge unrelated equipment into one record.
const NON_IDENTIFYING_SERIALS = new Set(['unknown', 'n/a', 'na', 'none', 'unk', 'tbd', '-', '--', '?'])
export function isIdentifyingSerial(value: string) {
  const normalized = value.trim().toLowerCase()
  return normalized.length > 0 && !NON_IDENTIFYING_SERIALS.has(normalized)
}

// ilike treats % and _ as wildcards - escape them so a serial containing
// either is matched literally instead of as a pattern.
export function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, '\\$&')
}

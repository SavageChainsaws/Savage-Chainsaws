// Shared with app/page.tsx (admin dashboard) and the push-notification API
// route, which both need to describe a unit the same way without importing
// from inside a page component.

// Maps a model's two-letter prefix to its equipment type - shared by the
// customer portal's Add to Fleet, Check In, and Edit Unit forms so picking
// a model can auto-fill the type without the customer choosing twice.
export const STIHL_PREFIX_MAP: Record<string, string> = {
  FC: 'Edger',
  FS: 'String Trimmer',
  MS: 'Chainsaw',
  HL: 'Hedge Trimmer',
  HT: 'Pole Saw',
  TS: 'Cut Quik Saw',
  KM: 'Kombi Unit',
  HS: 'Hedge Trimmer',
  BR: 'Backpack Blower',
  BG: 'Hand Blower',
  RB: 'Pressure Washer',
  RZ: 'Riding Lawn Mower',
  SR: 'Backpack Sprayer',
}

export const EQUIPMENT_CATEGORIES = [
  'Chainsaw',
  'Pole Saw',
  'String Trimmer',
  'Hedge Trimmer',
  'Handheld Hedge Trimmer',
  'Edger',
  'Cut Quik Saw',
  'Kombi Unit',
  'Backpack Blower',
  'Hand Blower',
  'Pressure Washer',
  'Riding Lawn Mower',
  'Backpack Sprayer',
  'Other',
]

// Statuses considered "currently in for service" - shared by the customer
// portal's unit groupings and maintenance-reminder check below.
export const ACTIVE_STATUSES = [
  'Received',
  'Diagnosing',
  'Needs Approval',
  'In Repair',
  'Repair Requested',
  'Ready for Pickup',
]

// A unit currently checked in doesn't need a reminder - it's already being
// serviced - and one with no service history yet has nothing to measure
// from, so neither case shows the indicator.
export function needsMaintenanceReminder(unit: { status: string; last_service_date: string | null }): boolean {
  if (ACTIVE_STATUSES.includes(unit.status)) return false
  if (!unit.last_service_date) return false
  const fourMonthsAgo = new Date()
  fourMonthsAgo.setMonth(fourMonthsAgo.getMonth() - 4)
  return new Date(unit.last_service_date) < fourMonthsAgo
}

export function monthsSince(dateString: string): number {
  const then = new Date(dateString)
  const now = new Date()
  return (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth())
}

// Model - Type first - never lead with serial
export function unitLabel(unit: { model?: string | null; equipment_type?: string | null; nickname?: string | null; serial_number?: string | null }) {
  const model = (unit.model || '').trim()
  const type = (unit.equipment_type || '').trim()
  if (model && type) return `${model} - ${type}`
  if (model) return model
  if (type) return type
  return unit.nickname || unit.serial_number || 'No model'
}

// Flat admin-set fee, auto-applied the moment the Priority checkbox is
// checked (updateStatus in app/actions/unitWorkflow.ts and the Create
// Invoice flow both derive it from is_priority, never a typed amount) -
// lives here rather than in unitWorkflow.ts because a 'use server' file
// can only export async functions, not plain constants.
export const PRIORITY_FEE = 75

export function isUnderWarranty(unit: { warranty_end: string | null }): boolean {
  if (!unit.warranty_end) return false
  const today = new Date().toISOString().slice(0, 10)
  return unit.warranty_end >= today
}

// A live, color-coded countdown - never a bare negative number, and never
// silently disappears once the end date has passed, so a customer can't
// mistake "no warning shown" for "still covered." Shared by the customer
// portal's UnitCard and selected-unit detail panel.
export function warrantyCountdown(warrantyEnd: string | null): { label: string; colorClass: string } | null {
  if (!warrantyEnd) return null
  const end = new Date(`${warrantyEnd}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const daysLeft = Math.round((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (daysLeft < 0) return { label: 'Expired', colorClass: 'text-red-400' }
  if (daysLeft === 0) return { label: 'Expires today', colorClass: 'text-red-400' }
  if (daysLeft <= 30) return { label: `${daysLeft} days left`, colorClass: 'text-amber-400' }
  return { label: `${daysLeft} days left`, colorClass: 'text-green-400' }
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

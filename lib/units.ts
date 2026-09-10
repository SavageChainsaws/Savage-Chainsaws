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

// Generic color helper, pulled out of app/page.tsx where it was a private
// closure used only to tint a customer group header with that customer's
// brand_color at low opacity. Falls back to the Savage orange on anything
// that isn't a valid 3- or 6-digit hex, rather than rendering transparent.

// Falls back to the Savage Chainsaws brand orange for any customer who
// hasn't set their own brand_color (paired with their logo on the customer
// portal) - used to box off each customer's units on the admin dashboard.
export const SAVAGE_BRAND_COLOR = '#ea580c'

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean
  const num = parseInt(full, 16)
  if (full.length !== 6 || Number.isNaN(num)) return `rgba(234, 88, 12, ${alpha})`
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

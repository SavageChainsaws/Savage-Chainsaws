import { formatShortDate } from '@/lib/dates'

type ServiceHistoryEntry = { unit_id: string; service_date: string; description: string }

// Replaces the old raw unit.history timestamp log - a quick "this unit
// was last in for X" reference instead. service_history rows are only
// created when a unit reaches Ready for Pickup, so the most recent entry
// is naturally the most recent *prior* completed visit, never the one
// in progress. Shows nothing if the unit has never completed a visit.
export default function MostRecentServiceHistorySection({
  unitId,
  serviceHistoryAll,
}: {
  unitId: string
  serviceHistoryAll: ServiceHistoryEntry[]
}) {
  const latest = serviceHistoryAll.filter(e => e.unit_id === unitId)[0]
  if (!latest) return null
  return (
    <div className="mt-3 border-t border-zinc-800 pt-2.5">
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Most Recent Service History</p>
      <p className="text-xs text-gray-500">{formatShortDate(latest.service_date)}</p>
      <p className="text-sm text-gray-300 whitespace-pre-wrap">{latest.description}</p>
    </div>
  )
}

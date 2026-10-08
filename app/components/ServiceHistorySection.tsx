import TitleCaseInput from './TitleCaseInput'
import { addServiceHistoryEntry, deleteServiceHistoryEntry } from '../actions/serviceHistory'
import { formatShortDate } from '@/lib/dates'

type ServiceHistoryEntry = { id: string; unit_id: string; service_date: string; description: string; cost: number | null }

export default function ServiceHistorySection({
  unit,
  serviceHistoryAll,
}: {
  unit: { id: string }
  serviceHistoryAll: ServiceHistoryEntry[]
}) {
  const entries = serviceHistoryAll.filter(e => e.unit_id === unit.id)
  return (
    <details className="mt-3 border-t border-zinc-800 pt-2.5 group/history-panel">
      <summary className="flex items-center justify-between cursor-pointer list-none select-none mb-2">
        <span className="text-xs text-gray-500 uppercase tracking-wider">
          Service History{entries.length > 0 ? ` (${entries.length})` : ''}
        </span>
        <span className="text-gray-500 text-xs group-open/history-panel:rotate-180 transition">v</span>
      </summary>
      {entries.length === 0 ? (
        <p className="text-xs text-gray-500 mb-2">
          No service history yet. Entries are logged automatically when a unit is marked Ready for Pickup.
        </p>
      ) : (
        <div className="space-y-1.5 mb-2">
          {entries.map(e => (
            <div key={e.id} className="flex flex-wrap items-start gap-2 text-sm">
              <span className="text-gray-500 w-24 shrink-0">{formatShortDate(e.service_date)}</span>
              <span className="text-gray-300 flex-1 min-w-[140px]">{e.description}</span>
              <span className="font-mono text-orange-300">{e.cost != null ? `$${Number(e.cost).toFixed(2)}` : '-'}</span>
              <form action={deleteServiceHistoryEntry}>
                <input type="hidden" name="id" value={e.id} />
                <button type="submit" className="text-xs text-red-400 hover:text-red-300">Remove</button>
              </form>
            </div>
          ))}
        </div>
      )}
      <details className="group/service-history">
        <summary className="inline-flex w-fit text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-orange-400 px-3 py-1.5 rounded-lg cursor-pointer list-none select-none">
          Add a service history entry
        </summary>
        <form action={addServiceHistoryEntry} className="mt-2 flex flex-wrap gap-2">
          <input type="hidden" name="unit_id" value={unit.id} />
          <input
            name="service_date"
            type="date"
            defaultValue={new Date().toISOString().split('T')[0]}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
          />
          <TitleCaseInput
            name="description"
            placeholder="Work performed"
            className="flex-1 min-w-[140px] bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
          />
          <input
            name="cost"
            type="number"
            step="0.01"
            min="0"
            placeholder="Cost $"
            className="w-28 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
          />
          <button type="submit" className="text-xs bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded-lg">
            Save
          </button>
        </form>
      </details>
    </details>
  )
}

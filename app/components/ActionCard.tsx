import Link from 'next/link'
import { unitLabel } from '@/lib/units'
import { formatDate, formatShortDate } from '@/lib/dates'
import { UnitPhoto } from './UnitPhoto'
import DeleteUnitButton from './DeleteUnitButton'
import NotesForm from './NotesForm'
import { snoozeUnit, markDecisionSeen, updateNotes } from '../actions/unitWorkflow'

type ActionUnit = {
  id: string
  customer_id: string | null
  model: string | null
  equipment_type: string | null
  nickname: string | null
  serial_number: string | null
  is_priority: boolean | null
  status: string
  notes: string | null
  notes_updated_at: string | null
  created_at: string
  hour_meter: string | null
  thumbnail_url?: string | null
  photo_url?: string | null
}

// The compact unit row used across the Action Center's status-based lists
// (Priority, Ready for Pickup, Repair Requested, Stagnant, etc.) - tapping
// it navigates to the full UnitDetailPanel for that unit rather than
// expanding inline, unlike UnitDetailPanel itself.
export default function ActionCard({
  unit,
  borderColor,
  isStale,
  days,
  showMarkSeen,
  children,
}: {
  unit: ActionUnit
  borderColor: string
  isStale: boolean
  days: number
  showMarkSeen: boolean
  children?: React.ReactNode
}) {
  return (
    <div className={`px-4 sm:px-6 py-3 hover:bg-zinc-800/40 transition border-l-4 ${borderColor}`}>
      <div className="flex items-start gap-3">
        <Link href={`/?customer=${unit.customer_id}&open=${unit.id}`} className="flex gap-3 sm:gap-4 flex-1 min-w-0">
          <UnitPhoto unit={unit} size="h-14 w-14 sm:h-24 sm:w-24" emptyContent="No photo" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-base sm:text-xl font-semibold truncate">{unitLabel(unit)}</p>
              {unit.is_priority && (
                <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-orange-500 text-black">PRIORITY</span>
              )}
              {isStale && (
                <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-red-600 text-white">
                  NEEDS ATTENTION - {days}d
                </span>
              )}
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                unit.status === 'Needs Approval' || unit.status === 'Repair Requested' ? 'bg-yellow-500/20 text-yellow-400'
                  : unit.status === 'Ready for Pickup' ? 'bg-green-500/20 text-green-400'
                  : unit.status === 'In Repair' ? 'bg-blue-500/20 text-blue-400'
                  : unit.status === 'Fleet' ? 'bg-zinc-600 text-gray-300'
                  : 'bg-orange-500/20 text-orange-400'
              }`}>{unit.status}</span>
            </div>
            <p className="text-sm text-gray-400">
              Serial: {unit.serial_number || '-'}
              {unit.nickname ? ` - ${unit.nickname}` : ''}
            </p>
            {children}
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500 mt-0.5">
              <span>Checked in: {formatDate(unit.created_at)}</span>
              {unit.hour_meter && <span>Hours: {unit.hour_meter}</span>}
            </div>
            <p className="text-xs text-orange-400 mt-2">Tap card to open unit {'->'}</p>
          </div>
        </Link>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <form action={snoozeUnit}>
            <input type="hidden" name="id" value={unit.id} />
            <input type="hidden" name="days" value="7" />
            <button type="submit" className="bg-zinc-700 hover:bg-zinc-600 text-white text-sm px-3 py-1.5 rounded-lg transition whitespace-nowrap">Delay 7 Days</button>
          </form>
          {showMarkSeen && (
            <form action={markDecisionSeen}>
              <input type="hidden" name="id" value={unit.id} />
              <button type="submit" className="bg-zinc-600 hover:bg-zinc-500 text-white text-sm px-3 py-1.5 rounded-lg transition whitespace-nowrap">Mark Seen</button>
            </form>
          )}
          <DeleteUnitButton id={unit.id} />
        </div>
      </div>
      <details className="mt-2 group/notes ml-[calc(3.5rem+0.75rem)] sm:ml-[calc(6rem+1rem)]">
        <summary className="text-xs text-orange-400 hover:text-orange-300 cursor-pointer list-none select-none">
          Notes {unit.notes ? `- has notes${unit.notes_updated_at ? ` (updated ${formatShortDate(unit.notes_updated_at)})` : ''}` : ''}
        </summary>
        <NotesForm unitId={unit.id} initialNotes={unit.notes || ''} action={updateNotes} />
      </details>
    </div>
  )
}

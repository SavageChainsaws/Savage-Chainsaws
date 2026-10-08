import { UnitPhoto } from './UnitPhoto'
import WarrantyShieldIcon from './WarrantyShieldIcon'
import { isUnderWarranty, unitLabel, warrantyCountdown } from '@/lib/units'
import { formatShortDate } from '@/lib/dates'

type CardUnit = {
  id: string
  serial_number: string
  model: string | null
  status: string
  problem_type: string | null
  diagnosis_notes: string | null
  equipment_type: string | null
  photo_url: string | null
  thumbnail_url: string | null
  nickname: string | null
  hour_meter: string | null
  warranty_end: string | null
}

// A customer's clickable summary row for one unit, shown in the My Fleet
// and Other Units lists (and wherever else the portal needs the same
// at-a-glance status card). Generic over the caller's own unit shape (it's
// always the full Unit type in practice) so onOpen can stay typed as
// (unit: Unit) => void on the caller's side without a contravariant
// parameter-type mismatch.
export default function UnitCard<U extends CardUnit>({ unit, onOpen }: { unit: U; onOpen: (unit: U) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(unit)}
      className="w-full text-left bg-zinc-900 border border-zinc-800 hover:border-orange-500/50 rounded-xl p-3 flex gap-3 transition"
    >
      <UnitPhoto unit={unit} size="h-14 w-14 sm:h-16 sm:w-16" />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-0.5">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <p className="font-semibold text-base sm:text-lg truncate">{unitLabel(unit)}</p>
            <span
              className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                unit.status === 'Needs Approval'
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : unit.status === 'Fleet'
                  ? 'bg-zinc-600 text-gray-300'
                  : unit.status === 'Ready for Pickup'
                  ? 'bg-green-500/20 text-green-400'
                  : unit.status === 'In Repair'
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'bg-orange-500/20 text-orange-400'
              }`}
            >
              {unit.status}
            </span>
            {unit.diagnosis_notes && (
              <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-orange-500/20 text-orange-300">
                Diagnosis Updated
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-zinc-700 text-gray-300">
              Serial: {unit.serial_number || '-'}
            </span>
            <WarrantyShieldIcon underWarranty={isUnderWarranty(unit)} />
          </div>
        </div>
        {(() => {
          const countdown = warrantyCountdown(unit.warranty_end)
          if (!countdown) return null
          return (
            <p className={`text-xs ${countdown.colorClass}`}>
              Warranty: {countdown.label} (ends {formatShortDate(unit.warranty_end)})
            </p>
          )
        })()}
        {(unit.nickname || unit.hour_meter) && (
          <p className="text-sm text-gray-400">
            {unit.nickname || ''}
            {unit.nickname && unit.hour_meter ? ' - ' : ''}
            {unit.hour_meter ? `${unit.hour_meter} hrs` : ''}
          </p>
        )}
        {unit.problem_type && unit.status !== 'Fleet' && (
          <p className="text-sm text-gray-500 mt-0.5">Problem: {unit.problem_type}</p>
        )}
        {unit.status === 'Needs Approval' && (
          <p className="text-xs text-yellow-400 mt-1">Tap to approve or decide {'->'}</p>
        )}
        {unit.status === 'Fleet' && (
          <p className="text-xs text-gray-500 mt-1">Tap to edit or schedule service {'->'}</p>
        )}
        {(unit.status === 'Repair Requested' || unit.status === 'Received' || unit.status === 'Diagnosing') && (
          <p className="text-xs text-gray-500 mt-1">Tap to view or withdraw service {'->'}</p>
        )}
      </div>
    </button>
  )
}

import ActionCard from './ActionCard'
import CustomerGroupHeader from './CustomerGroupHeader'
import { groupUnitsByCustomer } from '@/lib/units'
import { SAVAGE_BRAND_COLOR } from '@/lib/color'

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
  expedite_fee?: number | string | null
  problem_type?: string | null
  daysSinceCheckIn?: number
}

type GroupCustomer = { id: string; name?: string | null; brand_color?: string | null; logo_url?: string | null; referral_source_id?: string | null }

// Renders one of the Action Center's status-based lists (Priority, Ready
// for Pickup, Stagnant, etc.) as ActionCards boxed off per customer -
// shared by every section on the "no customer selected, no status filter"
// home view so each one groups/sorts/colors its units identically.
export default function GroupedActionList({
  units: list,
  customers,
  borderColor,
  renderExtra,
  isStaleInStatus,
  daysInStatus,
  isDecided,
}: {
  units: ActionUnit[]
  customers: GroupCustomer[] | null | undefined
  borderColor: string
  renderExtra?: (unit: ActionUnit) => React.ReactNode
  isStaleInStatus: (unit: ActionUnit) => boolean
  daysInStatus: (unit: ActionUnit) => number
  isDecided: (unit: ActionUnit) => boolean
}) {
  return (
    <>
      {groupUnitsByCustomer(list, customers).map(group => (
        <div
          key={group.customer?.id || 'unknown'}
          className="rounded-lg overflow-hidden"
          style={{ border: `2px solid ${group.customer?.brand_color || SAVAGE_BRAND_COLOR}` }}
        >
          <CustomerGroupHeader customer={group.customer} count={group.units.length} />
          <div className="divide-y divide-zinc-800/60">
            {group.units.map(unit => (
              <ActionCard
                key={unit.id}
                unit={unit}
                borderColor={borderColor}
                isStale={isStaleInStatus(unit)}
                days={daysInStatus(unit)}
                showMarkSeen={isDecided(unit)}
              >
                {renderExtra?.(unit)}
              </ActionCard>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

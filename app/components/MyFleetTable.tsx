import { isUnderWarranty, ACTIVE_STATUSES, needsMaintenanceReminder, monthsSince } from '@/lib/units'

type FleetUnit = {
  id: string
  serial_number: string
  model: string | null
  status: string
  equipment_type: string | null
  nickname: string | null
  warranty_end: string | null
  last_service_date: string | null
}

// Full reference table of every unit on a customer's account, active or
// not - lets them look up a serial number (e.g. to report a unit lost or
// stolen) without having to dig through the status-grouped lists below.
export default function MyFleetTable<U extends FleetUnit>({ units, onOpen }: { units: U[]; onOpen: (unit: U) => void }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-4 sm:px-6 py-3 border-b border-zinc-800">
        <h2 className="text-lg font-semibold text-orange-400">My Fleet</h2>
        <p className="text-xs text-gray-500 mt-1">
          Every unit on your account, active or not - keep your serial numbers on hand in case a unit is ever lost or stolen and you need to report it.
        </p>
      </div>
      {units.length === 0 ? (
        <p className="px-4 sm:px-6 py-5 text-gray-500 text-sm">No units on your account yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-zinc-800">
                <th className="px-4 sm:px-6 py-3">Model</th>
                <th className="px-3 py-3">Category</th>
                <th className="px-3 py-3">Serial Number</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Maintenance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {[...units]
                .sort((a, b) => (a.model || a.nickname || '').localeCompare(b.model || b.nickname || ''))
                .map(unit => (
                  <tr
                    key={unit.id}
                    onClick={() => onOpen(unit)}
                    className={`cursor-pointer hover:bg-zinc-800/40 transition ${
                      unit.status === 'Needs Approval' ? 'bg-red-500/10 border-l-4 border-l-red-500' : ''
                    }`}
                  >
                    <td className="px-4 sm:px-6 py-3 font-medium">
                      <div className="flex flex-wrap items-center gap-2">
                        {unit.status === 'Needs Approval' && (
                          <span className="inline-flex items-center gap-1 shrink-0 text-xs px-2 py-0.5 rounded-full font-bold bg-red-600 text-white">
                            <span className="h-1.5 w-1.5 rounded-full bg-white" />
                            Action Needed
                          </span>
                        )}
                        <span>{unit.model || '-'}</span>
                      </div>
                      {unit.nickname && (
                        <span className="block text-xs text-gray-500 font-normal">{unit.nickname}</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-gray-300">{unit.equipment_type || '-'}</td>
                    <td className="px-3 py-3 font-mono text-orange-300">{unit.serial_number || '-'}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`inline-block text-xs px-2.5 py-1 rounded-full font-medium ${
                          unit.status === 'Needs Approval' ? 'bg-yellow-500/20 text-yellow-400'
                            : unit.status === 'Fleet' ? 'bg-zinc-600 text-gray-300'
                            : unit.status === 'Ready for Pickup' ? 'bg-green-500/20 text-green-400'
                            : unit.status === 'In Repair' ? 'bg-blue-500/20 text-blue-400'
                            : 'bg-orange-500/20 text-orange-400'
                        }`}>{unit.status}</span>
                        {isUnderWarranty(unit) && (
                          <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-blue-500/20 text-blue-400">
                            Under Warranty
                          </span>
                        )}
                      </div>
                      <span className="block text-xs text-gray-500 mt-1">
                        {ACTIVE_STATUSES.includes(unit.status) ? 'In for service' : 'With you'}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {needsMaintenanceReminder(unit) ? (
                        <div
                          className="inline-flex flex-col"
                          title="It's been a while since this unit's last service. Regular maintenance helps avoid bigger, costlier repairs down the road."
                        >
                          <span className="inline-flex items-center gap-1.5 w-fit text-xs px-2.5 py-1 rounded-full font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                            Checkup Recommended
                          </span>
                          <span className="text-xs text-gray-500 mt-1">
                            {monthsSince(unit.last_service_date!)}+ months since last service
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-600">-</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

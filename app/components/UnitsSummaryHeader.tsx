type SummaryUnit = {
  id: string
  status: string
}

// The loud "Needs Approval" banner plus the four stat tiles (Total,
// Needs Approval, In Progress, Ready for Pickup) at the top of the
// customer portal - each tile jumps to a representative unit for its
// category via onOpen, reusing the same pin-to-top/scroll-into-view path
// as clicking a unit card directly.
export default function UnitsSummaryHeader<U extends SummaryUnit>({
  units,
  onOpen,
  onScrollToUnits,
}: {
  units: U[]
  onOpen: (unit: U) => void
  onScrollToUnits: () => void
}) {
  const total = units.length
  const needsApproval = units.filter(u => u.status === 'Needs Approval').length
  const inProgress = units.filter(u =>
    ['Diagnosing', 'In Repair', 'Repair Requested', 'Received'].includes(u.status)
  ).length
  const completed = units.filter(u => u.status === 'Ready for Pickup').length

  // Stat tiles jump to a representative unit for their category, reusing
  // the same openUnit()/pin-to-top/scroll-into-view path as clicking a
  // card directly - when a category has more than one unit, the first
  // match is opened and the rest stay visible (pinned) in their section.
  const firstNeedsApproval = units.find(u => u.status === 'Needs Approval')
  const firstInProgress = units.find(u =>
    ['Diagnosing', 'In Repair', 'Repair Requested', 'Received'].includes(u.status)
  )
  const firstReadyForPickup = units.find(u => u.status === 'Ready for Pickup')

  return (
    <>
      {/* Loud, animated banner above everything else when a decision is
          waiting - the "Needs Approval" stat tile below is easy to miss
          among three other equal-looking tiles (see animate-approval-pulse
          in globals.css for why). Redundant with that tile on purpose -
          this is the thing that's supposed to be impossible to miss, not
          a replacement for the other ways to get there. */}
      {needsApproval > 0 && firstNeedsApproval && (
        <button
          type="button"
          onClick={() => onOpen(firstNeedsApproval)}
          className="w-full flex items-center justify-between gap-3 bg-red-600 hover:bg-red-500 text-white rounded-xl px-4 py-3.5 sm:py-4 shadow-lg shadow-red-900/50 animate-approval-pulse transition"
        >
          <span className="flex items-center gap-2.5 min-w-0 text-left">
            <span className="text-2xl shrink-0" aria-hidden="true">⚠️</span>
            <span className="min-w-0">
              <span className="block font-bold text-base sm:text-lg leading-tight">
                {needsApproval === 1 ? '1 Repair Needs Your Approval' : `${needsApproval} Repairs Need Your Approval`}
              </span>
              <span className="block text-xs sm:text-sm text-red-100">Tap here to review and approve</span>
            </span>
          </span>
          <span className="text-2xl shrink-0" aria-hidden="true">{'->'}</span>
        </button>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <button
          type="button"
          onClick={onScrollToUnits}
          className="bg-zinc-900 border border-zinc-800 hover:border-zinc-600 rounded-xl p-3 text-left transition"
        >
          <p className="text-xs text-gray-500 uppercase">Total Units</p>
          <p className="text-2xl font-bold text-orange-400">{total}</p>
        </button>
        <button
          type="button"
          onClick={() => firstNeedsApproval && onOpen(firstNeedsApproval)}
          disabled={!firstNeedsApproval}
          className={`rounded-xl p-3 text-left transition ${
            needsApproval > 0
              ? 'bg-red-500/10 border border-red-500/50 hover:border-red-400'
              : 'bg-zinc-900 border border-zinc-800 cursor-default'
          }`}
        >
          <p className={`text-xs uppercase ${needsApproval > 0 ? 'text-red-400' : 'text-gray-500'}`}>Needs Approval</p>
          <p className={`text-2xl font-bold ${needsApproval > 0 ? 'text-red-400' : 'text-yellow-400'}`}>{needsApproval}</p>
        </button>
        <button
          type="button"
          onClick={() => firstInProgress && onOpen(firstInProgress)}
          disabled={!firstInProgress}
          className={`rounded-xl p-3 text-left transition ${
            inProgress > 0
              ? 'bg-blue-500/10 border border-blue-500/40 hover:border-blue-400'
              : 'bg-zinc-900 border border-zinc-800 cursor-default'
          }`}
        >
          <p className={`text-xs uppercase ${inProgress > 0 ? 'text-blue-400' : 'text-gray-500'}`}>In Progress</p>
          <p className="text-2xl font-bold text-blue-400">{inProgress}</p>
        </button>
        <button
          type="button"
          onClick={() => firstReadyForPickup && onOpen(firstReadyForPickup)}
          disabled={!firstReadyForPickup}
          className={`rounded-xl p-3 text-left transition ${
            completed > 0
              ? 'bg-green-500/10 border border-green-500/40 hover:border-green-400'
              : 'bg-zinc-900 border border-zinc-800 cursor-default'
          }`}
        >
          <p className={`text-xs uppercase ${completed > 0 ? 'text-green-400' : 'text-gray-500'}`}>Ready for Pickup</p>
          <p className="text-2xl font-bold text-green-400">{completed}</p>
        </button>
      </div>
    </>
  )
}

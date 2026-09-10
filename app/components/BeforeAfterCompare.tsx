'use client'

import { useState } from 'react'

export type ComparablePhoto = { id: string; url: string; label: string }

// Shown on both admin and customer unit detail views wherever a unit has at
// least one check-in ("before") photo and at least one later diagnosis
// ("after") photo on file - side-by-side is simplest and matches the
// existing photo galleries' plain-image style better than a slider widget
// would. Callers pass each list sorted oldest-first so the defaults below
// (earliest before, most recent after) line up with "drop-off vs pickup"
// without any extra sorting logic here.
export function BeforeAfterCompare({
  beforePhotos,
  afterPhotos,
}: {
  beforePhotos: ComparablePhoto[]
  afterPhotos: ComparablePhoto[]
}) {
  // Explicit selection only once the user actually picks something - both
  // callers' photo lists start empty and populate after an async fetch, so
  // seeding this from beforePhotos/afterPhotos directly (e.g. via useState's
  // one-time initializer) would freeze in whatever those lists looked like
  // on the very first render, before real data arrived. Falling back to the
  // default (earliest before / most recent after) below on every render
  // instead keeps the selection - and the <select> showing it - correct
  // once the photos actually load, and automatically resets to a valid
  // photo if the previously-selected one is ever removed.
  const [beforeId, setBeforeId] = useState<string | undefined>(undefined)
  const [afterId, setAfterId] = useState<string | undefined>(undefined)

  if (beforePhotos.length === 0 || afterPhotos.length === 0) return null

  const before = beforePhotos.find(p => p.id === beforeId) || beforePhotos[0]
  const after = afterPhotos.find(p => p.id === afterId) || afterPhotos[afterPhotos.length - 1]

  return (
    <details className="mt-3 border-t border-zinc-800 pt-2.5 group/compare-panel">
      <summary className="flex items-center justify-between cursor-pointer list-none select-none mb-2">
        <span className="text-xs text-gray-500 uppercase tracking-wider">Compare Before / After</span>
        <span className="text-gray-500 text-xs group-open/compare-panel:rotate-180 transition">v</span>
      </summary>
      <div className="space-y-2">
        {(beforePhotos.length > 1 || afterPhotos.length > 1) && (
          <div className="flex flex-wrap gap-2">
            {beforePhotos.length > 1 && (
              <select
                value={before.id}
                onChange={e => setBeforeId(e.target.value)}
                className="flex-1 min-w-[140px] bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs"
              >
                {beforePhotos.map(p => (
                  <option key={p.id} value={p.id}>Before: {p.label}</option>
                ))}
              </select>
            )}
            {afterPhotos.length > 1 && (
              <select
                value={after.id}
                onChange={e => setAfterId(e.target.value)}
                className="flex-1 min-w-[140px] bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs"
              >
                {afterPhotos.map(p => (
                  <option key={p.id} value={p.id}>After: {p.label}</option>
                ))}
              </select>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider text-center mb-1">Before - {before.label}</p>
            <img
              src={before.url}
              alt="Before"
              className="w-full aspect-square object-cover rounded-lg border border-zinc-700"
            />
          </div>
          <div>
            <p className="text-xs text-orange-400 uppercase tracking-wider text-center mb-1">After - {after.label}</p>
            <img
              src={after.url}
              alt="After"
              className="w-full aspect-square object-cover rounded-lg border border-orange-500/40"
            />
          </div>
        </div>
      </div>
    </details>
  )
}

'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import useLockBodyScroll from './useLockBodyScroll'

type SpecSheet = {
  id: string
  category: string
  models: string[]
  image_url: string
  source: string
}

// Browsable/searchable index over the scanned STIHL factory "Technical
// Data" sheet (carb models, spark plugs, idle/high-speed RPM, torque specs,
// etc. - 2018-02 USA edition, 36 pages) - see equipment_spec_sheets. Each
// row is one model group exactly as the catalog printed it (several
// closely related models often share one spec block, e.g. "FS 36, 40, 44,
// FC 44"); clicking a group opens that catalog page as a zoomable image
// rather than re-typing every number into the database by hand - those
// numbers (carb settings, torque, spark gap) are safety/warranty-relevant,
// so the scanned original stays the source of truth instead of a
// transcription that could quietly drift from it.
export default function SpecsBrowser({ sheets }: { sheets: SpecSheet[] }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [openSheet, setOpenSheet] = useState<SpecSheet | null>(null)

  useLockBodyScroll(!!openSheet)

  const categories = useMemo(
    () => Array.from(new Set(sheets.map(s => s.category))).sort(),
    [sheets]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sheets.filter(s => {
      if (category && s.category !== category) return false
      if (!q) return true
      return s.models.some(m => m.toLowerCase().includes(q))
    })
  }, [sheets, query, category])

  const grouped = useMemo(() => {
    const byCategory = new Map<string, SpecSheet[]>()
    for (const s of filtered) {
      if (!byCategory.has(s.category)) byCategory.set(s.category, [])
      byCategory.get(s.category)!.push(s)
    }
    return Array.from(byCategory.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-3 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Specs <span className="text-orange-500">& Technical Data</span>
            </h1>
            <p className="text-gray-400 text-sm">STIHL factory carburetor, spark plug, RPM, and torque specs</p>
          </div>
          <Link href="/" className="border border-zinc-600 hover:border-orange-500 text-xs px-3 py-1.5 rounded-lg whitespace-nowrap">
            Back to Dashboard
          </Link>
        </div>

        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search a model, e.g. MS 261, FS 90, BR 600..."
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm mb-3"
        />

        <div className="flex flex-wrap gap-2 mb-6">
          <button
            type="button"
            onClick={() => setCategory(null)}
            className={`text-xs px-3 py-1.5 rounded-lg border ${!category ? 'bg-orange-600 border-orange-600' : 'border-zinc-700 hover:border-orange-500'}`}
          >
            All
          </button>
          {categories.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c === category ? null : c)}
              className={`text-xs px-3 py-1.5 rounded-lg border ${category === c ? 'bg-orange-600 border-orange-600' : 'border-zinc-700 hover:border-orange-500'}`}
            >
              {c}
            </button>
          ))}
        </div>

        {grouped.length === 0 && (
          <p className="text-sm text-gray-500">No equipment matches &quot;{query}&quot;.</p>
        )}

        <div className="space-y-6">
          {grouped.map(([cat, group]) => (
            <div key={cat}>
              <h2 className="text-xs uppercase tracking-wide text-gray-500 mb-2">{cat}</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {group.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setOpenSheet(s)}
                    className="text-left bg-zinc-900 border border-zinc-800 hover:border-orange-500 rounded-lg px-3 py-2.5 text-sm transition"
                  >
                    {s.models.join(', ')}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {openSheet && (
        <div
          onClick={() => setOpenSheet(null)}
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 cursor-zoom-out"
        >
          <button
            type="button"
            onClick={() => setOpenSheet(null)}
            className="absolute top-4 right-4 text-white text-2xl leading-none h-10 w-10 flex items-center justify-center rounded-full bg-zinc-800/80 hover:bg-zinc-700"
            aria-label="Close preview"
          >
            &times;
          </button>
          <div className="flex flex-col items-center gap-2 max-h-full" onClick={e => e.stopPropagation()}>
            <img
              src={openSheet.image_url}
              alt={openSheet.models.join(', ')}
              className="max-h-[80vh] max-w-full object-contain rounded-lg bg-white"
            />
            <p className="text-xs text-gray-400">{openSheet.source} - {openSheet.models.join(', ')}</p>
          </div>
        </div>
      )}
    </div>
  )
}

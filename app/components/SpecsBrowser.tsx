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

type GuidePage = { page_number: number; section_label: string | null; image_url: string }

type Guide = {
  id: string
  title: string
  description: string | null
  category: string
  source: string
  reference_guide_pages: GuidePage[]
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
//
// A second "Guides & Reference" view sits alongside it for whole documents
// that aren't per-model (gasoline/ethanol guidelines, the QuickCheck no-
// start diagnostic, the chain ID system, the multi-section dealer
// Technical Reference Guide) - same scanned-page-is-the-source-of-truth
// approach, browsable by page with a section jump for the longer ones.
export default function SpecsBrowser({ sheets, guides }: { sheets: SpecSheet[]; guides: Guide[] }) {
  const [view, setView] = useState<'specs' | 'guides'>('specs')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [openSheet, setOpenSheet] = useState<SpecSheet | null>(null)
  const [openGuide, setOpenGuide] = useState<Guide | null>(null)
  const [pageIndex, setPageIndex] = useState(0)

  useLockBodyScroll(!!openSheet || !!openGuide)

  const categories = useMemo(
    () => Array.from(new Set(sheets.map(s => s.category))).sort(),
    [sheets]
  )
  const guideCategories = useMemo(
    () => Array.from(new Set(guides.map(g => g.category))).sort(),
    [guides]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sheets.filter(s => {
      if (category && s.category !== category) return false
      if (!q) return true
      return s.models.some(m => m.toLowerCase().includes(q))
    })
  }, [sheets, query, category])

  const filteredGuides = useMemo(() => {
    const q = query.trim().toLowerCase()
    return guides.filter(g => {
      if (category && g.category !== category) return false
      if (!q) return true
      return (
        g.title.toLowerCase().includes(q) ||
        (g.description || '').toLowerCase().includes(q) ||
        g.reference_guide_pages.some(p => (p.section_label || '').toLowerCase().includes(q))
      )
    })
  }, [guides, query, category])

  const grouped = useMemo(() => {
    const byCategory = new Map<string, SpecSheet[]>()
    for (const s of filtered) {
      if (!byCategory.has(s.category)) byCategory.set(s.category, [])
      byCategory.get(s.category)!.push(s)
    }
    return Array.from(byCategory.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  const groupedGuides = useMemo(() => {
    const byCategory = new Map<string, Guide[]>()
    for (const g of filteredGuides) {
      if (!byCategory.has(g.category)) byCategory.set(g.category, [])
      byCategory.get(g.category)!.push(g)
    }
    return Array.from(byCategory.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filteredGuides])

  function switchView(next: 'specs' | 'guides') {
    setView(next)
    setQuery('')
    setCategory(null)
  }

  function openGuideAt(guide: Guide, pageNumber?: number) {
    const idx = pageNumber ? guide.reference_guide_pages.findIndex(p => p.page_number === pageNumber) : 0
    setOpenGuide(guide)
    setPageIndex(idx >= 0 ? idx : 0)
  }

  const guideSections = useMemo(() => {
    if (!openGuide) return []
    const seen = new Set<string>()
    const out: { label: string; index: number }[] = []
    openGuide.reference_guide_pages.forEach((p, i) => {
      if (p.section_label && !seen.has(p.section_label)) {
        seen.add(p.section_label)
        out.push({ label: p.section_label, index: i })
      }
    })
    return out
  }, [openGuide])

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-3 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Specs <span className="text-orange-500">& Technical Data</span>
            </h1>
            <p className="text-gray-400 text-sm">STIHL factory specs, carb/torque charts, and reference guides</p>
          </div>
          <Link href="/" className="border border-zinc-600 hover:border-orange-500 text-xs px-3 py-1.5 rounded-lg whitespace-nowrap">
            Back to Dashboard
          </Link>
        </div>

        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => switchView('specs')}
            className={`text-sm px-4 py-2 rounded-lg border ${view === 'specs' ? 'bg-orange-600 border-orange-600' : 'border-zinc-700 hover:border-orange-500'}`}
          >
            Equipment Specs
          </button>
          <button
            type="button"
            onClick={() => switchView('guides')}
            className={`text-sm px-4 py-2 rounded-lg border ${view === 'guides' ? 'bg-orange-600 border-orange-600' : 'border-zinc-700 hover:border-orange-500'}`}
          >
            Guides & Reference
          </button>
        </div>

        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={view === 'specs' ? 'Search a model, e.g. MS 261, FS 90, BR 600...' : 'Search a guide or topic, e.g. carburetor kits, ethanol, chain...'}
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
          {(view === 'specs' ? categories : guideCategories).map(c => (
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

        {view === 'specs' ? (
          <>
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
          </>
        ) : (
          <>
            {groupedGuides.length === 0 && (
              <p className="text-sm text-gray-500">No guide matches &quot;{query}&quot;.</p>
            )}
            <div className="space-y-6">
              {groupedGuides.map(([cat, group]) => (
                <div key={cat}>
                  <h2 className="text-xs uppercase tracking-wide text-gray-500 mb-2">{cat}</h2>
                  <div className="space-y-2">
                    {group.map(g => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => openGuideAt(g)}
                        className="w-full text-left bg-zinc-900 border border-zinc-800 hover:border-orange-500 rounded-lg px-3 py-2.5 transition"
                      >
                        <div className="text-sm font-medium">{g.title}</div>
                        {g.description && <div className="text-xs text-gray-400 mt-0.5">{g.description}</div>}
                        <div className="text-[11px] text-gray-600 mt-1">{g.reference_guide_pages.length} page{g.reference_guide_pages.length === 1 ? '' : 's'}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
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

      {openGuide && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
          <div className="flex items-center justify-between gap-3 p-3 sm:p-4 border-b border-zinc-800 bg-zinc-950">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{openGuide.title}</div>
              <div className="text-xs text-gray-500">
                Page {pageIndex + 1} of {openGuide.reference_guide_pages.length}
                {openGuide.reference_guide_pages[pageIndex]?.section_label &&
                  ` - ${openGuide.reference_guide_pages[pageIndex].section_label}`}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {guideSections.length > 1 && (
                <select
                  value=""
                  onChange={e => {
                    const idx = Number(e.target.value)
                    if (!Number.isNaN(idx)) setPageIndex(idx)
                  }}
                  className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs"
                >
                  <option value="" disabled>
                    Jump to section...
                  </option>
                  {guideSections.map(s => (
                    <option key={s.index} value={s.index}>
                      {s.label}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={() => setOpenGuide(null)}
                className="text-white text-2xl leading-none h-9 w-9 flex items-center justify-center rounded-full bg-zinc-800/80 hover:bg-zinc-700"
                aria-label="Close guide"
              >
                &times;
              </button>
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center p-3 overflow-hidden relative">
            <button
              type="button"
              onClick={() => setPageIndex(i => Math.max(0, i - 1))}
              disabled={pageIndex === 0}
              className="absolute left-2 sm:left-4 text-white text-2xl leading-none h-10 w-10 flex items-center justify-center rounded-full bg-zinc-800/80 hover:bg-zinc-700 disabled:opacity-30"
              aria-label="Previous page"
            >
              &larr;
            </button>
            <img
              src={openGuide.reference_guide_pages[pageIndex]?.image_url}
              alt={`${openGuide.title} page ${pageIndex + 1}`}
              className="max-h-full max-w-full object-contain rounded-lg bg-white"
            />
            <button
              type="button"
              onClick={() => setPageIndex(i => Math.min(openGuide.reference_guide_pages.length - 1, i + 1))}
              disabled={pageIndex === openGuide.reference_guide_pages.length - 1}
              className="absolute right-2 sm:right-4 text-white text-2xl leading-none h-10 w-10 flex items-center justify-center rounded-full bg-zinc-800/80 hover:bg-zinc-700 disabled:opacity-30"
              aria-label="Next page"
            >
              &rarr;
            </button>
          </div>
          <p className="text-center text-xs text-gray-500 pb-3">{openGuide.source}</p>
        </div>
      )}
    </div>
  )
}

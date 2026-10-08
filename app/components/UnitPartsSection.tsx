import Link from 'next/link'
import UppercaseInput from './UppercaseInput'
import { resolveUnitParts } from '@/lib/parts'
import { upsertUnitPartOverride, deleteUnitPartOverride } from '../actions/unitParts'

export default function UnitPartsSection({
  unit,
  modelPartsAll,
  unitOverridesAll,
}: {
  unit: { id: string; model: string | null }
  modelPartsAll: unknown[]
  unitOverridesAll: unknown[]
}) {
  const parts = resolveUnitParts(unit, modelPartsAll, unitOverridesAll)
  return (
    <details className="mt-3 border-t border-zinc-800 pt-2.5 group/parts-panel">
      <summary className="flex items-center justify-between cursor-pointer list-none select-none mb-2">
        <span className="text-xs text-gray-500 uppercase tracking-wider">
          Parts &amp; SKUs (admin only){parts.length > 0 ? ` (${parts.length})` : ''}
        </span>
        <span className="text-gray-500 text-xs group-open/parts-panel:rotate-180 transition">v</span>
      </summary>
      {parts.length === 0 ? (
        <div className="mb-2 space-y-1.5">
          <p className="text-xs text-gray-500">No default parts set for this model yet.</p>
          <Link href="/parts" className="inline-block text-xs bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded-lg">
            Add one in the Parts Catalog
          </Link>
        </div>
      ) : (
        <div className="space-y-1.5 mb-2">
          {parts.map(p => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-gray-300 w-28 shrink-0">{p.part_name}</span>
              <span className="font-mono text-orange-300">{p.sku}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                p.sku_type === 'Aftermarket' ? 'bg-purple-500/20 text-purple-400' : 'bg-zinc-700 text-gray-300'
              }`}>
                {p.sku_type}
              </span>
              {p.isOverride ? (
                <>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-500/20 text-blue-400">
                    {p.hasDefault ? 'Overridden' : 'Unit-only'}
                  </span>
                  <form action={deleteUnitPartOverride}>
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className="text-xs text-red-400 hover:text-red-300">
                      {p.hasDefault ? 'Reset to default' : 'Remove'}
                    </button>
                  </form>
                </>
              ) : (
                <span className="text-xs text-gray-600">Model default</span>
              )}
            </div>
          ))}
        </div>
      )}
      <details className="group/parts">
        <summary className="inline-flex w-fit text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-orange-400 px-3 py-1.5 rounded-lg cursor-pointer list-none select-none">
          Override or add a part for this unit
        </summary>
        <form action={upsertUnitPartOverride} className="mt-2 flex flex-wrap gap-2">
          <input type="hidden" name="unit_id" value={unit.id} />
          <input type="hidden" name="unit_model" value={unit.model || ''} />
          <input
            name="part_name"
            list={`parts-${unit.id}`}
            placeholder="Part name (e.g. Blade)"
            className="flex-1 min-w-[140px] bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
          />
          <datalist id={`parts-${unit.id}`}>
            {parts.map(p => <option key={p.id} value={p.part_name} />)}
          </datalist>
          <UppercaseInput
            name="sku"
            placeholder="SKU"
            className="flex-1 min-w-[140px] font-mono bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
          />
          <select
            name="sku_type"
            defaultValue="OEM"
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
          >
            <option value="OEM">OEM (sets default for this model)</option>
            <option value="Aftermarket">Aftermarket (this unit only)</option>
          </select>
          <button type="submit" className="text-xs bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded-lg">
            Save
          </button>
        </form>
      </details>
    </details>
  )
}

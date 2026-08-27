import { getSessionInfo } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import UppercaseInput from '../components/UppercaseInput'

async function upsertModelPart(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const id = (formData.get('id') as string) || null
  const model = (formData.get('model') as string || '').trim()
  const partName = (formData.get('part_name') as string || '').trim()
  const sku = (formData.get('sku') as string || '').trim().toUpperCase()
  const skuType = (formData.get('sku_type') as string) === 'Aftermarket' ? 'Aftermarket' : 'OEM'
  if (!model || !partName || !sku) return

  if (id) {
    await supabase
      .from('model_parts')
      .update({ model, part_name: partName, sku, sku_type: skuType, updated_at: new Date().toISOString() })
      .eq('id', id)
  } else {
    await supabase
      .from('model_parts')
      .upsert(
        { model, part_name: partName, sku, sku_type: skuType },
        { onConflict: 'model_key,part_name_key' }
      )
  }
  revalidatePath('/parts')
  revalidatePath('/')
  revalidatePath('/reports')
}

async function deleteModelPart(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  await supabase.from('model_parts').delete().eq('id', id)
  revalidatePath('/parts')
  revalidatePath('/')
}

export default async function PartsPage() {
  const { supabase, user, isAdmin } = await getSessionInfo()
  if (!user || !isAdmin) redirect('/login')

  const { data: parts } = await supabase
    .from('model_parts')
    .select('*')
    .order('model')
    .order('part_name')

  const { data: unitModels } = await supabase
    .from('units')
    .select('model')
    .not('model', 'is', null)

  const distinctModels = Array.from(new Set((unitModels || []).map(u => u.model).filter(Boolean))) as string[]

  function normalizeModelKey(model: string) {
    return model.toUpperCase().replace(/\s+/g, '')
  }

  const groups = new Map<string, { model: string; parts: any[] }>()
  for (const p of parts || []) {
    if (!groups.has(p.model_key)) {
      groups.set(p.model_key, { model: p.model, parts: [] })
    }
    groups.get(p.model_key)!.parts.push(p)
  }
  const sortedGroups = Array.from(groups.entries()).sort((a, b) => a[1].model.localeCompare(b[1].model))

  return (
    <main className="min-h-screen bg-zinc-950 text-white p-4 sm:p-6 md:p-10">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/images/logo.png" alt="" className="h-10 w-10 object-contain" />
            <div>
              <h1 className="text-xl font-bold">
                SAVAGE <span className="text-orange-500">CHAINSAWS</span>
              </h1>
              <p className="text-xs text-gray-500">Parts Catalog - default SKUs by model</p>
            </div>
          </div>
          <Link
            href="/"
            className="border border-zinc-700 text-sm px-3 py-2 rounded-lg hover:bg-zinc-800"
          >
            {'<-'} Back to Dashboard
          </Link>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-6">
          <h2 className="font-semibold text-orange-400 mb-1">Add a Part</h2>
          <p className="text-xs text-gray-500 mb-4">
            Set the default SKU every unit of a model uses (e.g. the stock blade on every RZ 752i). Individual
            units can still override this on their own detail page.
          </p>
          <form action={upsertModelPart} className="grid sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Model *</label>
              <input
                name="model"
                required
                list="known-models"
                placeholder="e.g. RZ 752i"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
              />
              <datalist id="known-models">
                {distinctModels.map(m => <option key={m} value={m} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Part Name *</label>
              <input
                name="part_name"
                required
                placeholder="e.g. Blade, Belt, Tune-Up Kit"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">SKU *</label>
              <UppercaseInput
                name="sku"
                required
                placeholder="e.g. BLD-RZ752-001"
                className="w-full font-mono bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type</label>
              <select
                name="sku_type"
                defaultValue="OEM"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
              >
                <option value="OEM">OEM</option>
                <option value="Aftermarket">Aftermarket</option>
              </select>
            </div>
            <div className="sm:col-span-4">
              <button
                type="submit"
                className="bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-5 py-2 rounded-lg"
              >
                Save Part
              </button>
            </div>
          </form>
        </div>

        {sortedGroups.length === 0 ? (
          <p className="text-gray-500 text-sm">No default parts set up yet. Add one above.</p>
        ) : (
          <div className="space-y-4">
            {sortedGroups.map(([modelKey, group]) => {
              const variants = distinctModels.filter(m => normalizeModelKey(m) === modelKey && m !== group.model)
              return (
                <div key={modelKey} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                  <div className="px-4 sm:px-6 py-3 border-b border-zinc-800 bg-zinc-800/60">
                    <h3 className="font-semibold text-white">{group.model}</h3>
                    {variants.length > 0 && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        Also applies to units logged as: {variants.join(', ')}
                      </p>
                    )}
                  </div>
                  <div className="divide-y divide-zinc-800">
                    {group.parts.map((p: any) => (
                      <form
                        key={p.id}
                        action={upsertModelPart}
                        className="px-4 sm:px-6 py-3 flex flex-wrap items-center gap-2"
                      >
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="model" value={group.model} />
                        <input
                          name="part_name"
                          defaultValue={p.part_name}
                          className="flex-1 min-w-[140px] bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
                        />
                        <UppercaseInput
                          name="sku"
                          defaultValue={p.sku}
                          className="flex-1 min-w-[140px] font-mono bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
                        />
                        <select
                          name="sku_type"
                          defaultValue={p.sku_type}
                          className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm"
                        >
                          <option value="OEM">OEM</option>
                          <option value="Aftermarket">Aftermarket</option>
                        </select>
                        <button
                          type="submit"
                          className="text-xs border border-zinc-600 hover:border-orange-500 px-3 py-1.5 rounded-lg"
                        >
                          Save
                        </button>
                        <button
                          type="submit"
                          formAction={deleteModelPart}
                          className="text-xs text-red-400 hover:text-red-300 px-2 py-1.5"
                        >
                          Delete
                        </button>
                      </form>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}

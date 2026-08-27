import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import Link from 'next/link'
import { createClient, getSessionInfo } from '@/lib/supabase/server'
import InactivityRedirect from './components/InactivityRedirect'
import LastViewedBanner from './components/LastViewedBanner'
import AdminLogout from './components/AdminLogout'
import DeleteUnitButton from './components/DeleteUnitButton'
import CheckInForm from './components/CheckInForm'
import { UnitPhoto } from './components/UnitPhoto'

function stampHistory(existing: string | null, entry: string) {
  const line = `${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} - ${entry}`
  return existing ? `${line}\n${existing}` : line
}

async function addUnit(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const serial = formData.get('serial') as string
  const model = formData.get('model') as string
  const problemType = formData.get('problem_type') as string
  const customerNotes = formData.get('customer_notes') as string
  const customerId = formData.get('customer_id') as string
  const checkInDate = formData.get('check_in_date') as string
  const photoUrl = (formData.get('photo_url') as string) || null
  const equipmentType = formData.get('equipment_type') as string
  const hourMeter = formData.get('hour_meter') as string
  const partNumber = formData.get('part_number') as string
  const isPriority = formData.get('is_priority') === 'true'
  const expediteFeeRaw = formData.get('expedite_fee') as string
  const expediteFee = expediteFeeRaw ? Number(expediteFeeRaw) : null
  const history = stampHistory(null, `Checked in${isPriority ? ' (PRIORITY)' : ''}${problemType ? ` - ${problemType}` : ''}`)
  await supabase.from('units').insert({
    serial_number: serial,
    model: model || null,
    problem_type: problemType || null,
    notes: customerNotes || null,
    customer_id: customerId,
    status: 'Diagnosing',
    decision_seen: true,
    photo_url: photoUrl,
    thumbnail_url: photoUrl,
    equipment_type: equipmentType || null,
    hour_meter: hourMeter || null,
    part_number: partNumber || null,
    is_priority: isPriority,
    expedite_fee: expediteFee,
    history,
    created_at: checkInDate ? new Date(checkInDate).toISOString() : new Date().toISOString(),
  })
  revalidatePath('/')
}

async function addFleetUnit(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const serial = formData.get('serial') as string
  const model = formData.get('model') as string
  const customerId = formData.get('customer_id') as string
  const equipmentType = formData.get('equipment_type') as string
  const hourMeter = formData.get('hour_meter') as string
  const purchaseDate = formData.get('purchase_date') as string
  const lastServiceDate = formData.get('last_service_date') as string
  const warrantyEnd = formData.get('warranty_end') as string
  const fleetNotes = formData.get('fleet_notes') as string
  const partNumbers = formData.get('part_numbers') as string
  const nickname = formData.get('nickname') as string

  await supabase.from('units').insert({
    serial_number: serial,
    model: model || null,
    customer_id: customerId,
    status: 'Fleet',
    decision_seen: true,
    equipment_type: equipmentType || null,
    hour_meter: hourMeter || null,
    purchase_date: purchaseDate || null,
    last_service_date: lastServiceDate || null,
    warranty_end: warrantyEnd || null,
    fleet_notes: fleetNotes || null,
    part_numbers: partNumbers || null,
    nickname: nickname || null,
    history: stampHistory(null, 'Added to fleet inventory'),
  })
  revalidatePath('/')
}

async function updateFleetUnit(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  const fleetNotes = formData.get('fleet_notes') as string
  const partNumbers = formData.get('part_numbers') as string
  const lastServiceDate = formData.get('last_service_date') as string
  const purchaseDate = formData.get('purchase_date') as string
  const warrantyEnd = formData.get('warranty_end') as string
  const hourMeter = formData.get('hour_meter') as string
  const nickname = formData.get('nickname') as string
  const serial = formData.get('serial') as string

  const update: any = {
    fleet_notes: fleetNotes || null,
    part_numbers: partNumbers || null,
    last_service_date: lastServiceDate || null,
    purchase_date: purchaseDate || null,
    warranty_end: warrantyEnd || null,
    hour_meter: hourMeter || null,
    nickname: nickname || null,
  }
  if (serial?.trim()) update.serial_number = serial.trim()

  await supabase.from('units').update(update).eq('id', id)
  revalidatePath('/')
}

async function scheduleFleetService(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  const note = (formData.get('service_note') as string) || ''
  const { data: existing } = await supabase
    .from('units')
    .select('history, notes')
    .eq('id', id)
    .single()

  const entry = note.trim()
    ? `Scheduled for service: ${note.trim()}`
    : 'Scheduled for service from fleet'

  await supabase.from('units').update({
    status: 'Repair Requested',
    decision_seen: true,
    problem_type: note.trim() || 'Service requested from fleet',
    notes: existing?.notes ? `${entry}\n${existing.notes}` : entry,
    history: stampHistory(existing?.history, entry),
  }).eq('id', id)

  revalidatePath('/')
}

async function returnToFleet(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  const { data: existing } = await supabase
    .from('units')
    .select('history')
    .eq('id', id)
    .single()

  await supabase.from('units').update({
    status: 'Fleet',
    decision_seen: true,
    problem_type: null,
    history: stampHistory(existing?.history, 'Withdrawn from shop - returned to fleet'),
  }).eq('id', id)

  revalidatePath('/')
}

async function updateStatus(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  const status = formData.get('status') as string
  const notes = formData.get('notes') as string
  const file = formData.get('invoice') as File
  const isPriority = formData.get('is_priority') === 'true'
  const expediteFeeRaw = formData.get('expedite_fee') as string
  const { data: existing } = await supabase.from('units').select('status, history, is_priority').eq('id', id).single()
  const updateData: any = {
    status,
    notes: notes || null,
    is_priority: isPriority,
  }
  if (expediteFeeRaw !== null && expediteFeeRaw !== undefined && expediteFeeRaw !== '') {
    updateData.expedite_fee = Number(expediteFeeRaw)
  }
  if (existing && existing.status !== status) {
    updateData.history = stampHistory(existing.history, `Status -> ${status}`)
  }
  if (status === 'Completed' || status === 'Ready for Pickup') {
    updateData.last_service_date = new Date().toISOString().split('T')[0]
  }
  if (file && typeof file === 'object' && 'size' in file && file.size > 0) {
    try {
      const bytes = await file.arrayBuffer()
      const fileName = `${id}-${Date.now()}-${file.name || 'file'}`
      const { error: uploadError } = await supabase.storage
        .from('invoices')
        .upload(fileName, bytes, {
          contentType: file.type || 'application/octet-stream',
          upsert: false,
        })
      if (!uploadError) {
        const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(fileName)
        updateData.invoice_url = publicUrl
        updateData.history = stampHistory(updateData.history || existing?.history, 'File uploaded')
      }
    } catch {
      // ignore
    }
  }
  await supabase.from('units').update(updateData).eq('id', id)
  revalidatePath('/')
}

async function markDecisionSeen(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  await supabase.from('units').update({ decision_seen: true }).eq('id', id)
  revalidatePath('/')
}

async function snoozeUnit(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  const days = Number(formData.get('days') || 7)
  const snoozeUntil = new Date()
  snoozeUntil.setDate(snoozeUntil.getDate() + days)
  const { data: existing } = await supabase.from('units').select('history').eq('id', id).single()
  await supabase
    .from('units')
    .update({
      snoozed_until: snoozeUntil.toISOString(),
      decision_seen: true,
      history: stampHistory(existing?.history, `Snoozed ${days} days`),
    })
    .eq('id', id)
  revalidatePath('/')
}

async function updateNotes(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  const notes = formData.get('notes') as string
  await supabase.from('units').update({ notes: notes || null }).eq('id', id)
  revalidatePath('/')
}

async function upsertUnitPartOverride(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = (formData.get('id') as string) || null
  const unitId = formData.get('unit_id') as string
  const partName = (formData.get('part_name') as string || '').trim()
  const sku = (formData.get('sku') as string || '').trim()
  if (!unitId || !partName || !sku) return

  if (id) {
    await supabase
      .from('unit_part_overrides')
      .update({ part_name: partName, sku, updated_at: new Date().toISOString() })
      .eq('id', id)
  } else {
    await supabase
      .from('unit_part_overrides')
      .upsert(
        { unit_id: unitId, part_name: partName, sku },
        { onConflict: 'unit_id,part_name_key' }
      )
  }
  revalidatePath('/')
}

async function deleteUnitPartOverride(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  await supabase.from('unit_part_overrides').delete().eq('id', id)
  revalidatePath('/')
}

function getFleetColor(unit: any): 'red' | 'green' | 'orange' {
  const threeMonthsAgo = new Date()
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
  const lastService = unit.last_service_date ? new Date(unit.last_service_date) : null
  const purchase = unit.purchase_date ? new Date(unit.purchase_date) : null
  const reference = lastService || purchase
  if (unit.status === 'Completed' || unit.status === 'Ready for Pickup' || lastService) {
    if (reference && reference < threeMonthsAgo) return 'red'
    return 'green'
  }
  if (reference && reference < threeMonthsAgo) return 'red'
  return 'orange'
}

function equipmentGroup(type: string | null): number {
  if (!type) return 3
  const t = type.toLowerCase()
  if (t.includes('riding') || (t.includes('mower') && !t.includes('walk'))) return 1
  if (t.includes('chainsaw') || t.includes('pole') || t.includes('cutquik') || t.includes('hedge')) return 2
  return 3
}

function groupLabel(n: number) {
  if (n === 1) return 'Riding Mowers'
  if (n === 2) return 'Chainsaws / Handheld'
  return 'Trimmers & Misc'
}

// Model - Type first - never lead with serial
function unitLabel(unit: any) {
  const model = (unit.model || '').trim()
  const type = (unit.equipment_type || '').trim()
  if (model && type) return `${model} - ${type}`
  if (model) return model
  if (type) return type
  return unit.nickname || unit.serial_number || 'No model'
}

function isUnderWarranty(unit: any): boolean {
  if (!unit.warranty_end) return false
  const today = new Date().toISOString().slice(0, 10)
  return unit.warranty_end >= today
}

function normalizeModelKey(model: string | null): string {
  return (model || '').toUpperCase().replace(/\s+/g, '')
}

// Merges a unit's model-level default parts with any unit-specific
// overrides. Matching is by normalized model/part-name key (mirrors the
// DB's generated model_key/part_name_key columns) so casing/spacing
// differences in how a model was typed don't split one physical model
// into separate part sets. A unit override always wins over its model
// default; an override with no matching model default still shows, as a
// part unique to that one unit.
function resolveUnitParts(unit: any, modelPartsAll: any[], unitOverridesAll: any[]) {
  const modelKey = normalizeModelKey(unit.model)
  const defaults = modelPartsAll.filter(p => p.model_key === modelKey)
  const overrides = unitOverridesAll.filter(o => o.unit_id === unit.id)
  const overrideByKey = new Map(overrides.map(o => [o.part_name_key, o]))

  const resolved: { id: string; part_name: string; sku: string; isOverride: boolean; hasDefault: boolean }[] = []
  for (const d of defaults) {
    const override = overrideByKey.get(d.part_name_key)
    resolved.push({
      id: override ? override.id : d.id,
      part_name: override ? override.part_name : d.part_name,
      sku: override ? override.sku : d.sku,
      isOverride: !!override,
      hasDefault: true,
    })
  }
  const defaultKeys = new Set(defaults.map(d => d.part_name_key))
  for (const o of overrides) {
    if (defaultKeys.has(o.part_name_key)) continue
    resolved.push({ id: o.id, part_name: o.part_name, sku: o.sku, isOverride: true, hasDefault: false })
  }
  return resolved.sort((a, b) => a.part_name.localeCompare(b.part_name))
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string; status?: string; open?: string }>
}) {
  const { supabase, user, isAdmin } = await getSessionInfo()
  if (!user || !isAdmin) redirect('/login')

  const params = await searchParams
  const selectedCustomerId = params.customer || null
  const statusFilter = params.status || null
  const openUnitId = params.open || null

  const { data: customers } = await supabase.from('customers').select('*').order('name')
  const { data: allUnits } = await supabase.from('units').select('*').order('created_at', { ascending: false })
  const { data: modelPartsAll } = await supabase.from('model_parts').select('*')
  const { data: unitOverridesAll } = await supabase.from('unit_part_overrides').select('*')

  let units = allUnits
  if (selectedCustomerId && !statusFilter) {
    units = allUnits?.filter(u => u.customer_id === selectedCustomerId) || []
  }

  const diagnosing = allUnits?.filter(u => u.status === 'Diagnosing').length || 0
  const needsApproval = allUnits?.filter(u => u.status === 'Needs Approval').length || 0
  const inRepair = allUnits?.filter(u => u.status === 'In Repair').length || 0
  const completed = allUnits?.filter(u => u.status === 'Completed' || u.status === 'Ready for Pickup').length || 0
  const repairRequested = allUnits?.filter(u => u.status === 'Repair Requested').length || 0
  const readyPickup = allUnits?.filter(u => u.status === 'Ready for Pickup').length || 0
  const priorityCount = allUnits?.filter(u => u.is_priority && u.status !== 'Completed').length || 0

  const fleetUnitsAll = (selectedCustomerId
    ? allUnits?.filter(u => u.customer_id === selectedCustomerId)
    : allUnits) || []
  const unitsCount = fleetUnitsAll.length

  const statusFilteredUnits = (() => {
    if (!statusFilter || !allUnits) return []
    let list = allUnits
    if (selectedCustomerId) {
      list = list.filter(u => u.customer_id === selectedCustomerId)
    }
    if (statusFilter === 'Priority') return list.filter(u => u.is_priority && u.status !== 'Completed')
    if (statusFilter === 'Completed') return list.filter(u => u.status === 'Completed' || u.status === 'Ready for Pickup')
    if (statusFilter === 'Units') return list
    return list.filter(u => u.status === statusFilter)
  })()

  const currentCustomer = customers?.find(c => c.id === selectedCustomerId)
  const now = new Date()
  const isSnoozed = (u: any) => u.snoozed_until && new Date(u.snoozed_until) > now

  const staleUnits = (units?.filter(u => {
    if (isSnoozed(u)) return false
    if (['Completed', 'Registered', 'Ready for Pickup', 'Fleet'].includes(u.status)) return false
    const days = Math.floor((now.getTime() - new Date(u.created_at).getTime()) / (1000 * 60 * 60 * 24))
    return days >= 7
  }) || []).map(u => ({
    ...u,
    daysSinceCheckIn: Math.floor((now.getTime() - new Date(u.created_at).getTime()) / (1000 * 60 * 60 * 24)),
  }))

  const approvedDecisions = units?.filter(u => !u.decision_seen && u.notes?.includes('Approved by')) || []
  const deniedDecisions = units?.filter(u => !u.decision_seen && u.notes?.includes('Denied by')) || []
  const waitingOnCustomer = units?.filter(u => u.status === 'Needs Approval' && !isSnoozed(u)) || []
  const repairRequestedUnits = units?.filter(u => u.status === 'Repair Requested' && !isSnoozed(u)) || []
  const diagnosingUnits = units?.filter(u =>
    u.status === 'Diagnosing' && !isSnoozed(u) &&
    Math.floor((now.getTime() - new Date(u.created_at).getTime()) / (1000 * 60 * 60 * 24)) < 7
  ) || []
  const readyForPickupUnits = units?.filter(u => u.status === 'Ready for Pickup' && !isSnoozed(u)) || []
  const priorityUnits = units?.filter(u => u.is_priority && u.status !== 'Completed' && !isSnoozed(u)) || []

  const customerFleet = selectedCustomerId
    ? (allUnits?.filter(u => u.customer_id === selectedCustomerId) || [])
    : []
  const sortedFleet = [...customerFleet].sort((a, b) => {
    const ga = equipmentGroup(a.equipment_type)
    const gb = equipmentGroup(b.equipment_type)
    if (ga !== gb) return ga - gb
    return (a.serial_number || '').localeCompare(b.serial_number || '')
  })

  const repairUnits = units?.filter(u => u.status !== 'Fleet') || []

  function formatDate(dateString: string | null) {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  }
  function formatShortDate(dateString: string | null) {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  }

  function ActionCard({ unit, borderColor, children }: { unit: any; borderColor: string; children?: React.ReactNode }) {
    return (
      <div className={`px-4 sm:px-6 py-4 hover:bg-zinc-800/40 transition border-l-4 ${borderColor}`}>
        <div className="flex items-start gap-3">
          <Link href={`/?customer=${unit.customer_id}&open=${unit.id}`} className="flex gap-3 sm:gap-4 flex-1 min-w-0">
            <UnitPhoto unit={unit} size="h-14 w-14 sm:h-24 sm:w-24" emptyContent="No photo" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-base sm:text-xl font-semibold truncate">{unitLabel(unit)}</p>
                {unit.is_priority && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-orange-500 text-black">PRIORITY</span>
                )}
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                  unit.status === 'Needs Approval' || unit.status === 'Repair Requested' ? 'bg-yellow-500/20 text-yellow-400'
                    : unit.status === 'Completed' || unit.status === 'Ready for Pickup' ? 'bg-green-500/20 text-green-400'
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
            {(approvedDecisions.some(d => d.id === unit.id) || deniedDecisions.some(d => d.id === unit.id)) && (
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
            Notes {unit.notes ? '- has notes' : ''}
          </summary>
          <form action={updateNotes} className="mt-2">
            <input type="hidden" name="id" value={unit.id} />
            <textarea name="notes" defaultValue={unit.notes || ''} rows={2} placeholder="Add internal notes..." className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" />
            <button type="submit" className="mt-1.5 text-xs text-orange-400 hover:text-orange-300">Save Notes</button>
          </form>
        </details>
      </div>
    )
  }

  function UnitPartsSection({ unit }: { unit: any }) {
    const parts = resolveUnitParts(unit, modelPartsAll || [], unitOverridesAll || [])
    return (
      <div className="mt-4 border-t border-zinc-800 pt-3">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Parts &amp; SKUs (admin only)</p>
        {parts.length === 0 ? (
          <p className="text-xs text-gray-500 mb-2">
            No default parts set for this model yet. <Link href="/parts" className="text-orange-400 hover:text-orange-300">Add one in the Parts Catalog</Link>.
          </p>
        ) : (
          <div className="space-y-1.5 mb-2">
            {parts.map(p => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-gray-300 w-28 shrink-0">{p.part_name}</span>
                <span className="font-mono text-orange-300">{p.sku}</span>
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
          <summary className="text-xs text-orange-400 hover:text-orange-300 cursor-pointer list-none select-none">
            Override or add a part for this unit
          </summary>
          <form action={upsertUnitPartOverride} className="mt-2 flex flex-wrap gap-2">
            <input type="hidden" name="unit_id" value={unit.id} />
            <input
              name="part_name"
              list={`parts-${unit.id}`}
              placeholder="Part name (e.g. Blade)"
              className="flex-1 min-w-[140px] bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
            />
            <datalist id={`parts-${unit.id}`}>
              {parts.map(p => <option key={p.id} value={p.part_name} />)}
            </datalist>
            <input
              name="sku"
              placeholder="SKU"
              className="flex-1 min-w-[140px] font-mono bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
            />
            <button type="submit" className="text-xs bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded-lg">
              Save
            </button>
          </form>
        </details>
      </div>
    )
  }

  function groupUnitsByCustomer(unitList: any[]) {
    const groups = new Map<string, { customer: any; units: any[] }>()
    for (const unit of unitList) {
      const key = unit.customer_id || 'unknown'
      if (!groups.has(key)) {
        groups.set(key, { customer: customers?.find(c => c.id === unit.customer_id) || null, units: [] })
      }
      groups.get(key)!.units.push(unit)
    }
    return Array.from(groups.values()).sort((a, b) => {
      if (b.units.length !== a.units.length) return b.units.length - a.units.length
      return (a.customer?.name || 'Unknown').localeCompare(b.customer?.name || 'Unknown')
    })
  }

  function CustomerGroupHeader({ customer, count }: { customer: any; count: number }) {
    return (
      <div className="flex items-center gap-3 px-4 sm:px-6 py-3 bg-zinc-800 border-b border-zinc-700">
        {customer?.logo_url ? (
          <img
            src={customer.logo_url}
            alt={customer.name}
            className="h-9 w-9 rounded-lg object-contain bg-zinc-900 border border-zinc-700 shrink-0"
          />
        ) : null}
        <h3 className="text-lg sm:text-xl font-bold text-white truncate">{customer?.name || 'Unknown Customer'}</h3>
        <span className="text-xs text-gray-400 shrink-0 ml-auto">{count} unit{count !== 1 ? 's' : ''}</span>
      </div>
    )
  }

  function GroupedActionList({
    units: list,
    borderColor,
    renderExtra,
  }: {
    units: any[]
    borderColor: string
    renderExtra?: (unit: any) => React.ReactNode
  }) {
    return (
      <>
        {groupUnitsByCustomer(list).map((group, i) => (
          <div key={group.customer?.id || 'unknown'} className={i > 0 ? 'border-t-4 border-zinc-950' : ''}>
            <CustomerGroupHeader customer={group.customer} count={group.units.length} />
            <div className="divide-y divide-zinc-800/60">
              {group.units.map(unit => (
                <ActionCard key={unit.id} unit={unit} borderColor={borderColor}>
                  {renderExtra?.(unit)}
                </ActionCard>
              ))}
            </div>
          </div>
        ))}
      </>
    )
  }

  let lastGroup = 0

  const tiles = [
    { key: 'Diagnosing', label: 'Diagnosing', count: diagnosing, color: 'text-orange-400' },
    { key: 'Needs Approval', label: 'Needs Approval', count: needsApproval, color: 'text-yellow-400' },
    { key: 'In Repair', label: 'In Repair', count: inRepair, color: 'text-blue-400' },
    { key: 'Repair Requested', label: 'Requested', count: repairRequested, color: 'text-blue-300' },
    { key: 'Ready for Pickup', label: 'Ready', count: readyPickup, color: 'text-green-300' },
    { key: 'Completed', label: 'Completed', count: completed, color: 'text-green-400' },
    { key: 'Priority', label: 'Priority', count: priorityCount, color: 'text-orange-500' },
    { key: 'Units', label: 'All Units', count: unitsCount, color: 'text-orange-300' },
  ]

  return (
    <main className="min-h-screen bg-zinc-950 text-white p-4 sm:p-6 md:p-10">
      <Suspense fallback={null}><InactivityRedirect /></Suspense>

      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 md:mb-10 bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-6">
          <div className="flex items-center gap-4">
            <img src="/images/logo.png" alt="Savage Chainsaws" className="h-16 w-16 md:h-20 md:w-20 object-contain" />
            <div>
              <h1 className="text-2xl md:text-4xl font-bold tracking-tight">
                SAVAGE <span className="text-orange-500">CHAINSAWS</span>
              </h1>
              <p className="text-gray-400 mt-1 text-sm">Unit Tracking Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <form className="flex items-center gap-2 sm:gap-3">
              <select name="customer" defaultValue={selectedCustomerId || ''} className="bg-zinc-900 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 max-w-[200px] sm:max-w-none">
                <option value="">All Customers (Action Center)</option>
                {customers?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button type="submit" className="bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition">Switch</button>
            </form>
            <Link
              href="/reports"
              className="border border-zinc-600 hover:border-orange-500 text-xs px-3 py-1.5 rounded-lg"
            >
              Reports
            </Link>
            <Link
              href="/inventory"
              className="border border-zinc-600 hover:border-orange-500 text-xs px-3 py-1.5 rounded-lg"
            >
              Inventory
            </Link>
            <Link
              href="/parts"
              className="border border-zinc-600 hover:border-orange-500 text-xs px-3 py-1.5 rounded-lg"
            >
              Parts
            </Link>
            <AdminLogout />
          </div>
        </div>

        <Suspense fallback={null}><LastViewedBanner customers={customers || []} /></Suspense>

        {currentCustomer && (
          <div className="mb-6">
            <p className="text-xl font-semibold text-orange-400">{currentCustomer.name}</p>
            <p className="text-sm text-gray-400">Total Units: <span className="text-white font-medium">{units?.length || 0}</span></p>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-3 md:gap-4 mb-8 md:mb-10">
          {tiles.map(tile => {
            const href = selectedCustomerId
              ? `/?customer=${selectedCustomerId}&status=${encodeURIComponent(tile.key)}`
              : `/?status=${encodeURIComponent(tile.key)}`
            const active = statusFilter === tile.key
            return (
              <Link
                key={tile.key}
                href={href}
                className={`bg-zinc-900 border rounded-xl p-4 md:p-5 transition hover:border-orange-500/60 flex flex-col items-center justify-between min-h-[88px] md:min-h-[100px] ${
                  active ? 'border-orange-500' : 'border-zinc-800'
                }`}
              >
                <p className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wider text-center leading-tight min-h-[2rem] flex items-center justify-center">
                  {tile.label}
                </p>
                <p className={`text-2xl md:text-3xl font-bold ${tile.color} text-center`}>{tile.count}</p>
              </Link>
            )
          })}
        </div>

        {statusFilter && (
          <div className="bg-zinc-900 border border-orange-400/40 rounded-xl overflow-hidden mb-8">
            <div className="px-6 py-4 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-orange-300">
                  {statusFilter === 'Units' ? 'All Units' : statusFilter} ({statusFilteredUnits.length})
                </h2>
                <p className="text-xs text-gray-500 mt-1">Tap any card to open that unit for update</p>
              </div>
              <Link
                href={selectedCustomerId ? `/?customer=${selectedCustomerId}` : '/'}
                className="text-sm text-gray-400 hover:text-white border border-zinc-700 rounded-lg px-4 py-2 transition"
              >
                {'<-'} Back to {selectedCustomerId ? 'customer' : 'Action Center'}
              </Link>
            </div>
            {statusFilteredUnits.length === 0 ? (
              <p className="px-6 py-8 text-gray-500 text-sm">No units found.</p>
            ) : (
              <div className="divide-y divide-zinc-800">
                {groupUnitsByCustomer(statusFilteredUnits).map((group, i) => (
                  <div key={group.customer?.id || 'unknown'} className={i > 0 ? 'border-t-4 border-zinc-950' : ''}>
                    <CustomerGroupHeader customer={group.customer} count={group.units.length} />
                    <div className="divide-y divide-zinc-800/60">
                      {group.units.map(unit => (
                        <Link
                          key={unit.id}
                          href={`/?customer=${unit.customer_id}&open=${unit.id}`}
                          className="px-6 py-4 flex items-center gap-3 hover:bg-zinc-800/50 transition block"
                        >
                          <UnitPhoto unit={unit} size="h-12 w-12" />
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold truncate">{unitLabel(unit)}</p>
                            <p className="text-sm text-gray-400 truncate">
                              Serial: {unit.serial_number || '-'}
                              {unit.nickname ? ` - ${unit.nickname}` : ''}
                            </p>
                            {unit.problem_type && (
                              <p className="text-xs text-gray-500 mt-0.5 truncate">{unit.problem_type}</p>
                            )}
                          </div>
                          <span className={`text-xs px-2.5 py-1 rounded-full shrink-0 ${
                            unit.status === 'Needs Approval' || unit.status === 'Repair Requested' ? 'bg-yellow-500/20 text-yellow-400'
                              : unit.status === 'Completed' || unit.status === 'Ready for Pickup' ? 'bg-green-500/20 text-green-400'
                              : unit.status === 'In Repair' ? 'bg-blue-500/20 text-blue-400'
                              : 'bg-orange-500/20 text-orange-400'
                          }`}>{unit.status}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!selectedCustomerId && !statusFilter && (
          <>
            {priorityUnits.length > 0 && (
              <div className="bg-zinc-900 border border-orange-500/50 rounded-xl overflow-hidden mb-8">
                <div className="px-6 py-4 border-b border-zinc-800"><h2 className="text-lg font-semibold text-orange-400">Priority Units ({priorityUnits.length})</h2></div>
                <div className="divide-y divide-zinc-800">
                  <GroupedActionList
                    units={priorityUnits}
                    borderColor="border-orange-500"
                    renderExtra={unit => (
                      <p className="text-sm text-orange-300">{unit.expedite_fee ? `Expedite fee: $${Number(unit.expedite_fee).toFixed(2)}` : 'Priority flag set'}</p>
                    )}
                  />
                </div>
              </div>
            )}
            {readyForPickupUnits.length > 0 && (
              <div className="bg-zinc-900 border border-green-500/40 rounded-xl overflow-hidden mb-8">
                <div className="px-6 py-4 border-b border-zinc-800"><h2 className="text-lg font-semibold text-green-300">Ready for Pickup ({readyForPickupUnits.length})</h2></div>
                <div className="divide-y divide-zinc-800">
                  <GroupedActionList
                    units={readyForPickupUnits}
                    borderColor="border-green-400"
                    renderExtra={unit => (
                      <p className="text-sm text-green-300">{unit.notes || 'Ready for customer pickup'}</p>
                    )}
                  />
                </div>
              </div>
            )}
            {repairRequestedUnits.length > 0 && (
              <div className="bg-zinc-900 border border-blue-500/30 rounded-xl overflow-hidden mb-8">
                <div className="px-6 py-4 border-b border-zinc-800"><h2 className="text-lg font-semibold text-blue-300">Repair Requested ({repairRequestedUnits.length})</h2></div>
                <div className="divide-y divide-zinc-800">
                  <GroupedActionList
                    units={repairRequestedUnits}
                    borderColor="border-blue-400"
                    renderExtra={unit => (
                      <p className="text-sm text-blue-300">{unit.notes || unit.problem_type || 'Customer requested repair'}</p>
                    )}
                  />
                </div>
              </div>
            )}
            {diagnosingUnits.length > 0 && (
              <div className="bg-zinc-900 border border-orange-500/30 rounded-xl overflow-hidden mb-8">
                <div className="px-6 py-4 border-b border-zinc-800"><h2 className="text-lg font-semibold text-orange-400">Diagnosing ({diagnosingUnits.length})</h2></div>
                <div className="divide-y divide-zinc-800">
                  <GroupedActionList
                    units={diagnosingUnits}
                    borderColor="border-orange-500"
                    renderExtra={unit => (
                      <p className="text-sm text-orange-300">{unit.problem_type || unit.notes || 'In diagnosis'}</p>
                    )}
                  />
                </div>
              </div>
            )}
            {staleUnits.length > 0 && (
              <div className="bg-zinc-900 border border-red-500/30 rounded-xl overflow-hidden mb-8">
                <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-red-400">Stagnant Units ({staleUnits.length})</h2>
                  <p className="text-xs text-red-300/80">Over 7 days with no action</p>
                </div>
                <div className="divide-y divide-zinc-800">
                  <GroupedActionList
                    units={staleUnits}
                    borderColor="border-red-500"
                    renderExtra={unit => (
                      <p className="text-sm text-red-400 font-medium">No action for {unit.daysSinceCheckIn} days</p>
                    )}
                  />
                </div>
              </div>
            )}
            {approvedDecisions.length > 0 && (
              <div className="bg-zinc-900 border border-green-500/30 rounded-xl overflow-hidden mb-8">
                <div className="px-6 py-4 border-b border-zinc-800"><h2 className="text-lg font-semibold text-green-400">Customer Approved ({approvedDecisions.length})</h2></div>
                <div className="divide-y divide-zinc-800">
                  <GroupedActionList
                    units={approvedDecisions}
                    borderColor="border-green-500"
                    renderExtra={unit => (
                      <p className="text-sm text-green-300 font-medium">{unit.notes}</p>
                    )}
                  />
                </div>
              </div>
            )}
            {deniedDecisions.length > 0 && (
              <div className="bg-zinc-900 border border-red-500/30 rounded-xl overflow-hidden mb-8">
                <div className="px-6 py-4 border-b border-zinc-800"><h2 className="text-lg font-semibold text-red-400">Customer Denied ({deniedDecisions.length})</h2></div>
                <div className="divide-y divide-zinc-800">
                  <GroupedActionList
                    units={deniedDecisions}
                    borderColor="border-red-500"
                    renderExtra={unit => (
                      <p className="text-sm text-red-300 font-medium">{unit.notes}</p>
                    )}
                  />
                </div>
              </div>
            )}
            <div className="bg-zinc-900 border border-yellow-500/30 rounded-xl overflow-hidden mb-8">
              <div className="px-6 py-4 border-b border-zinc-800"><h2 className="text-lg font-semibold text-yellow-400">Waiting on Customer ({waitingOnCustomer.length})</h2></div>
              {waitingOnCustomer.length === 0 ? (
                <p className="px-6 py-8 text-gray-500 text-sm">No units currently waiting on customer approval.</p>
              ) : (
                <div className="divide-y divide-zinc-800">
                  <GroupedActionList
                    units={waitingOnCustomer}
                    borderColor="border-yellow-500"
                    renderExtra={() => (
                      <p className="text-sm text-yellow-300">Waiting for customer decision</p>
                    )}
                  />
                </div>
              )}
            </div>
          </>
        )}

        {selectedCustomerId && !statusFilter && (
          <>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-6 mb-6">
              <h2 className="text-lg font-semibold mb-4 text-orange-400">Check In New Unit</h2>
              <CheckInForm customerId={selectedCustomerId} addUnitAction={addUnit} />
            </div>

            <details
              className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-6 group"
              open={!!openUnitId && repairUnits.some(u => u.id === openUnitId)}
            >
              <summary className="px-4 sm:px-6 py-4 cursor-pointer list-none flex items-center justify-between hover:bg-zinc-800/40 transition">
                <h2 className="font-semibold text-orange-400">All Units - Repair Flow ({repairUnits.length})</h2>
                <span className="text-gray-500 text-sm group-open:rotate-180 transition">v</span>
              </summary>
              <div className="border-t border-zinc-800 divide-y divide-zinc-800">
                {repairUnits.length === 0 && (
                  <p className="px-6 py-8 text-gray-500 text-sm">No active repair units.</p>
                )}
                {repairUnits.map(unit => {
                  return (
                    <details
                      key={unit.id}
                      className="group/item"
                      open={openUnitId === unit.id}
                      id={`unit-${unit.id}`}
                    >
                      <summary className="px-4 sm:px-6 py-3 cursor-pointer hover:bg-zinc-800/50 transition flex items-center gap-3">
                        <UnitPhoto unit={unit} size="h-12 w-12" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium truncate">{unitLabel(unit)}</p>
                            {unit.is_priority && <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-orange-500 text-black">PRIORITY</span>}
                            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                              unit.status === 'Needs Approval' || unit.status === 'Repair Requested' ? 'bg-yellow-500/20 text-yellow-400'
                                : unit.status === 'Completed' || unit.status === 'Ready for Pickup' ? 'bg-green-500/20 text-green-400'
                                : unit.status === 'In Repair' ? 'bg-blue-500/20 text-blue-400'
                                : 'bg-orange-500/20 text-orange-400'
                            }`}>{unit.status}</span>
                          </div>
                          <p className="text-xs text-gray-500">
                            Serial: {unit.serial_number || '-'}
                            {unit.nickname ? ` - ${unit.nickname}` : ''}
                          </p>
                        </div>
                      </summary>
                      <div className="px-4 sm:px-6 pb-5">
                        <form action={updateStatus} encType="multipart/form-data" className="space-y-3">
                          <input type="hidden" name="id" value={unit.id} />
                          <div className="flex flex-wrap items-center gap-3">
                            <select name="status" defaultValue={unit.status} key={unit.id + unit.status} className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm">
                              <option value="Registered">Registered</option>
                              <option value="Repair Requested">Repair Requested</option>
                              <option value="Diagnosing">Diagnosing</option>
                              <option value="Needs Approval">Needs Approval</option>
                              <option value="In Repair">In Repair</option>
                              <option value="Ready for Pickup">Ready for Pickup</option>
                              <option value="Completed">Completed</option>
                              <option value="Fleet">Fleet</option>
                            </select>
                            <label className="flex items-center gap-1.5 text-xs text-orange-400 cursor-pointer">
                              <input type="checkbox" name="is_priority" value="true" defaultChecked={!!unit.is_priority} className="rounded border-zinc-600 bg-zinc-800 text-orange-500" />
                              Priority
                            </label>
                            <input name="expedite_fee" type="number" step="0.01" min="0" defaultValue={unit.expedite_fee ?? ''} placeholder="Fee $" className="w-24 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm" />
                            <button type="submit" className="bg-orange-600 hover:bg-orange-500 text-white text-sm px-4 py-1.5 rounded-lg">Update</button>
                            <DeleteUnitButton id={unit.id} />
                          </div>
                          <textarea name="notes" defaultValue={unit.notes || ''} rows={2} placeholder="Notes..." className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                          {(unit.status === 'Needs Approval' || unit.status === 'Completed' || unit.status === 'Ready for Pickup') && (
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">{unit.status === 'Needs Approval' ? 'Upload Invoice / Photo' : 'Upload Photo'}</label>
                              <input type="file" name="invoice" accept="image/*,.pdf" className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-orange-600 file:text-white" />
                            </div>
                          )}
                          {unit.invoice_url && (
                            <a href={unit.invoice_url} target="_blank" rel="noreferrer" className="text-xs text-orange-400 hover:text-orange-300">View uploaded file {'->'}</a>
                          )}
                        </form>

                        {(unit.status === 'Repair Requested' || unit.status === 'Diagnosing' || unit.status === 'Registered') && (
                          <form action={returnToFleet} className="pt-3">
                            <input type="hidden" name="id" value={unit.id} />
                            <button type="submit" className="bg-zinc-700 hover:bg-zinc-600 text-white text-sm px-4 py-1.5 rounded-lg">
                              Withdraw {'->'} Return to Fleet
                            </button>
                          </form>
                        )}

                        {unit.history && (
                          <div className="mt-4 border-t border-zinc-800 pt-3">
                            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">History</p>
                            <pre className="text-xs text-gray-400 whitespace-pre-wrap font-sans leading-relaxed">{unit.history}</pre>
                          </div>
                        )}

                        <UnitPartsSection unit={unit} />
                      </div>
                    </details>
                  )
                })}
              </div>
            </details>

            <details className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-6 group">
              <summary className="px-4 sm:px-6 py-4 cursor-pointer list-none flex items-center justify-between hover:bg-zinc-800/40 transition">
                <div className="flex items-center gap-3">
                  <h2 className="font-semibold text-orange-300">Fleet Units ({sortedFleet.length})</h2>
                  <span className="text-xs text-gray-500 hidden sm:inline inline-flex items-center gap-3">
                    <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-green-500" />Serviced</span>
                    <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-orange-500" />Known</span>
                    <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-red-500" />Due</span>
                  </span>
                </div>
                <span className="text-gray-500 text-sm group-open:rotate-180 transition">v</span>
              </summary>
              <div className="border-t border-zinc-800">
                <details className="border-b border-zinc-800">
                  <summary className="px-4 sm:px-6 py-3 cursor-pointer list-none flex items-center gap-2 text-sm text-orange-400 hover:text-orange-300 hover:bg-zinc-800/30 transition">
                    <span className="text-lg leading-none">+</span>
                    <span className="font-medium">Add Unit to Fleet</span>
                  </summary>
                  <form action={addFleetUnit} className="px-4 sm:px-6 pb-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <input type="hidden" name="customer_id" value={selectedCustomerId} />
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Model</label>
                      <input name="model" placeholder="e.g. RZ 752" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Serial Number *</label>
                      <input name="serial" required className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Nickname (optional)</label>
                      <input name="nickname" placeholder="e.g. T1" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Equipment Type</label>
                      <select name="equipment_type" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm">
                        <option>Riding Mower</option>
                        <option>Walk-Behind Mower</option>
                        <option>Chainsaw</option>
                        <option>Pole Saw</option>
                        <option>String Trimmer</option>
                        <option>Hedge Trimmer</option>
                        <option>Blower</option>
                        <option>Backpack Blower</option>
                        <option>Edger</option>
                        <option>Cutquik</option>
                        <option>Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Purchase Date</label>
                      <input type="date" name="purchase_date" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Last Service Date</label>
                      <input type="date" name="last_service_date" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Warranty End Date</label>
                      <input type="date" name="warranty_end" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Hour Meter</label>
                      <input name="hour_meter" placeholder="e.g. 12.5" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">Part Numbers</label>
                      <input name="part_numbers" placeholder="Parts needed..." className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <label className="block text-xs text-gray-500 mb-1">Fleet Notes</label>
                      <textarea name="fleet_notes" rows={2} placeholder="Anything about this unit..." className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <button type="submit" className="bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-5 py-2 rounded-lg">Add to Fleet</button>
                    </div>
                  </form>
                </details>

                {sortedFleet.length === 0 ? (
                  <p className="px-6 py-8 text-gray-500 text-sm">No fleet units yet. Use + Add Unit to Fleet above.</p>
                ) : (
                  <div className="divide-y divide-zinc-800">
                    {sortedFleet.map(unit => {
                      const g = equipmentGroup(unit.equipment_type)
                      const showHeader = g !== lastGroup
                      if (showHeader) lastGroup = g
                      const color = getFleetColor(unit)
                      return (
                        <div key={unit.id}>
                          {showHeader && (
                            <div className="px-4 sm:px-6 py-2 bg-zinc-800/50">
                              <p className="text-xs uppercase tracking-wider text-gray-400 font-medium">{groupLabel(g)}</p>
                            </div>
                          )}
                          <details className="group/fleet">
                            <summary className="px-4 sm:px-6 py-3 cursor-pointer hover:bg-zinc-800/40 transition flex items-center justify-between gap-2">
                              <div className="flex items-center gap-3 min-w-0">
                                <span className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${color === 'red' ? 'bg-red-500' : color === 'green' ? 'bg-green-500' : 'bg-orange-500'}`} />
                                <UnitPhoto unit={unit} size="h-10 w-10" />
                                <div className="min-w-0">
                                  <p className="font-medium truncate">{unitLabel(unit)}</p>
                                  <p className="text-xs text-gray-500 truncate">
                                    Serial: {unit.serial_number || '-'}
                                    {unit.nickname ? ` - ${unit.nickname}` : ''}
                                    {unit.hour_meter ? ` - ${unit.hour_meter} hrs` : ''}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {isUnderWarranty(unit) && (
                                  <span className="text-xs px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-400">Under Warranty</span>
                                )}
                                <span className={`text-xs px-2.5 py-1 rounded-full ${
                                  unit.status === 'Fleet' ? 'bg-zinc-700 text-gray-300'
                                    : unit.status === 'Completed' || unit.status === 'Ready for Pickup' ? 'bg-green-500/20 text-green-400'
                                    : 'bg-orange-500/20 text-orange-400'
                                }`}>{unit.status}</span>
                              </div>
                            </summary>
                            <div className="px-4 sm:px-6 pb-4 space-y-3">
                              <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                                <span>Purchased: {formatShortDate(unit.purchase_date)}</span>
                                <span>Last service: {formatShortDate(unit.last_service_date)}</span>
                                <span>Warranty end: {formatShortDate(unit.warranty_end)}</span>
                              </div>
                              <form action={updateFleetUnit} className="space-y-3">
                                <input type="hidden" name="id" value={unit.id} />
                                <div className="grid sm:grid-cols-2 gap-3">
                                  <div>
                                    <label className="block text-xs text-gray-500 mb-1">Nickname</label>
                                    <input name="nickname" defaultValue={unit.nickname || ''} placeholder="e.g. T1" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                                  </div>
                                  <div>
                                    <label className="block text-xs text-gray-500 mb-1">Serial Number</label>
                                    <input name="serial" defaultValue={unit.serial_number || ''} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                                  </div>
                                  <div>
                                    <label className="block text-xs text-gray-500 mb-1">Purchase Date</label>
                                    <input type="date" name="purchase_date" defaultValue={unit.purchase_date || ''} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                                  </div>
                                  <div>
                                    <label className="block text-xs text-gray-500 mb-1">Last Service Date</label>
                                    <input type="date" name="last_service_date" defaultValue={unit.last_service_date || ''} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                                  </div>
                                  <div>
                                    <label className="block text-xs text-gray-500 mb-1">Warranty End Date</label>
                                    <input type="date" name="warranty_end" defaultValue={unit.warranty_end || ''} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                                  </div>
                                  <div>
                                    <label className="block text-xs text-gray-500 mb-1">Hour Meter</label>
                                    <input name="hour_meter" defaultValue={unit.hour_meter || ''} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                                  </div>
                                  <div>
                                    <label className="block text-xs text-gray-500 mb-1">Part Numbers</label>
                                    <input name="part_numbers" defaultValue={unit.part_numbers || ''} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                                  </div>
                                </div>
                                <div>
                                  <label className="block text-xs text-gray-500 mb-1">Fleet Notes</label>
                                  <textarea name="fleet_notes" rows={2} defaultValue={unit.fleet_notes || ''} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                                </div>
                                <div className="flex gap-2">
                                  <button type="submit" className="bg-orange-600 hover:bg-orange-500 text-white text-sm px-4 py-1.5 rounded-lg">Save</button>
                                  <DeleteUnitButton id={unit.id} />
                                </div>
                              </form>

                              <UnitPartsSection unit={unit} />

                              {unit.status === 'Fleet' && (
                                <form action={scheduleFleetService} className="border-t border-zinc-800 pt-3 space-y-2">
                                  <input type="hidden" name="id" value={unit.id} />
                                  <label className="block text-xs text-gray-500">Schedule service / send to shop</label>
                                  <input
                                    name="service_note"
                                    placeholder="e.g. 3-month tune-up, won't start..."
                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                                  />
                                  <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-1.5 rounded-lg">
                                    Send to Repair Flow
                                  </button>
                                </form>
                              )}
                            </div>
                          </details>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </details>
          </>
        )}
      </div>
    </main>
  )
}

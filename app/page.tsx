import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { Suspense } from 'react'
import Link from 'next/link'
import InactivityRedirect from './components/InactivityRedirect'
import LastViewedBanner from './components/LastViewedBanner'
import AdminLogout from './components/AdminLogout'
import DeleteUnitButton from './components/DeleteUnitButton'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function addUnit(formData: FormData) {
  'use server'
  const serial = formData.get('serial') as string
  const model = formData.get('model') as string
  const problemType = formData.get('problem_type') as string
  const customerNotes = formData.get('customer_notes') as string
  const customerId = formData.get('customer_id') as string
  const checkInDate = formData.get('check_in_date') as string
  const photo = formData.get('photo') as File

  let photoUrl: string | null = null

  if (photo && typeof photo === 'object' && 'size' in photo && photo.size > 0) {
    try {
      const bytes = await photo.arrayBuffer()
      const ext = (photo.name && photo.name.includes('.')) ? photo.name.split('.').pop() : 'jpg'
      const fileName = `checkin-${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from('invoices')
        .upload(fileName, bytes, {
          contentType: photo.type || 'image/jpeg',
          upsert: false,
        })
      if (!uploadError) {
        const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(fileName)
        photoUrl = publicUrl
      }
    } catch {
      // Photo failed — still create the unit without it
    }
  }

  await supabase.from('units').insert({
    serial_number: serial,
    model: model || null,
    problem_type: problemType || null,
    notes: customerNotes || null,
    customer_id: customerId,
    status: 'Diagnosing',
    decision_seen: true,
    photo_url: photoUrl,
    created_at: checkInDate ? new Date(checkInDate).toISOString() : new Date().toISOString(),
  })

  revalidatePath('/')
}

async function updateStatus(formData: FormData) {
  'use server'
  const id = formData.get('id') as string
  const status = formData.get('status') as string
  const notes = formData.get('notes') as string
  const file = formData.get('invoice') as File

  const updateData: any = {
    status,
    notes: notes || null,
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
      }
    } catch {
      // Upload failed — still update status/notes
    }
  }

  await supabase.from('units').update(updateData).eq('id', id)
  revalidatePath('/')
}

async function markDecisionSeen(formData: FormData) {
  'use server'
  const id = formData.get('id') as string
  await supabase.from('units').update({ decision_seen: true }).eq('id', id)
  revalidatePath('/')
}

async function snoozeUnit(formData: FormData) {
  'use server'
  const id = formData.get('id') as string
  const days = Number(formData.get('days') || 7)
  const snoozeUntil = new Date()
  snoozeUntil.setDate(snoozeUntil.getDate() + days)

  await supabase
    .from('units')
    .update({ snoozed_until: snoozeUntil.toISOString(), decision_seen: true })
    .eq('id', id)

  revalidatePath('/')
}

async function updateNotes(formData: FormData) {
  'use server'
  const id = formData.get('id') as string
  const notes = formData.get('notes') as string
  await supabase.from('units').update({ notes: notes || null }).eq('id', id)
  revalidatePath('/')
}

async function markMessageRead(formData: FormData) {
  'use server'
  const id = formData.get('id') as string
  await supabase.from('messages').update({ is_read: true }).eq('id', id)
  revalidatePath('/')
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>
}) {
  const params = await searchParams
  const selectedCustomerId = params.customer || null

  const { data: customers } = await supabase
    .from('customers')
    .select('*')
    .order('name')

  let unitsQuery = supabase.from('units').select('*').order('created_at', { ascending: false })
  if (selectedCustomerId) {
    unitsQuery = unitsQuery.eq('customer_id', selectedCustomerId)
  }
  const { data: units } = await unitsQuery

  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('is_read', false)
    .order('created_at', { ascending: false })

  const diagnosing = units?.filter(u => u.status === 'Diagnosing').length || 0
  const needsApproval = units?.filter(u => u.status === 'Needs Approval').length || 0
  const inRepair = units?.filter(u => u.status === 'In Repair').length || 0
  const completed = units?.filter(u => u.status === 'Completed').length || 0
  const repairRequested = units?.filter(u => u.status === 'Repair Requested').length || 0

  const currentCustomer = customers?.find(c => c.id === selectedCustomerId)
  const now = new Date()
  const isSnoozed = (u: any) => u.snoozed_until && new Date(u.snoozed_until) > now

  const staleUnits = (units?.filter(u => {
    if (isSnoozed(u)) return false
    if (u.status === 'Completed' || u.status === 'Registered') return false
    const days = Math.floor((now.getTime() - new Date(u.created_at).getTime()) / (1000 * 60 * 60 * 24))
    return days >= 7
  }) || []).map(u => ({
    ...u,
    daysSinceCheckIn: Math.floor((now.getTime() - new Date(u.created_at).getTime()) / (1000 * 60 * 60 * 24)),
  }))

  const approvedDecisions = units?.filter(u =>
    !u.decision_seen &&
    u.notes?.includes('Approved by')
  ) || []

  const deniedDecisions = units?.filter(u =>
    !u.decision_seen &&
    u.notes?.includes('Denied by')
  ) || []

  const waitingOnCustomer = units?.filter(u =>
    u.status === 'Needs Approval' && !isSnoozed(u)
  ) || []

  const repairRequestedUnits = units?.filter(u =>
    u.status === 'Repair Requested' && !isSnoozed(u)
  ) || []

  function formatDate(dateString: string | null) {
    if (!dateString) return '—'
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  function ActionCard({
    unit,
    borderColor,
    children,
  }: {
    unit: any
    borderColor: string
    children?: React.ReactNode
  }) {
    return (
      <div className={`px-6 py-5 hover:bg-zinc-800/40 transition border-l-4 ${borderColor}`}>
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm text-gray-400">
              <span className="text-orange-400 font-medium">
                {customers?.find(c => c.id === unit.customer_id)?.name || 'Unknown'}
              </span>
            </p>
            <div className="flex items-center gap-3">
              <p className="text-xl font-semibold">{unit.serial_number}</p>
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                unit.status === 'Needs Approval' || unit.status === 'Repair Requested'
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : unit.status === 'Completed'
                  ? 'bg-green-500/20 text-green-400'
                  : unit.status === 'In Repair'
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'bg-orange-500/20 text-orange-400'
              }`}>
                {unit.status}
              </span>
            </div>
            {children}
            <div className="flex flex-wrap gap-4 text-xs text-gray-500 mt-2">
              <span>Checked in: {formatDate(unit.created_at)}</span>
              {unit.model && <span>Model: {unit.model}</span>}
            </div>
            {unit.photo_url && (
              <a href={unit.photo_url} target="_blank" rel="noreferrer" className="inline-block mt-2">
                <img src={unit.photo_url} alt="Check-in photo" className="h-20 w-20 object-cover rounded-lg border border-zinc-700" />
              </a>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/?customer=${unit.customer_id}`}
              className="bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition whitespace-nowrap"
            >
              Go to Unit →
            </Link>
            <form action={snoozeUnit}>
              <input type="hidden" name="id" value={unit.id} />
              <input type="hidden" name="days" value="7" />
              <button type="submit" className="bg-zinc-700 hover:bg-zinc-600 text-white text-sm px-4 py-2 rounded-lg transition whitespace-nowrap">
                Delay 7 Days
              </button>
            </form>
            {(approvedDecisions.some(d => d.id === unit.id) || deniedDecisions.some(d => d.id === unit.id)) && (
              <form action={markDecisionSeen}>
                <input type="hidden" name="id" value={unit.id} />
                <button type="submit" className="bg-zinc-600 hover:bg-zinc-500 text-white text-sm px-4 py-2 rounded-lg transition whitespace-nowrap">
                  Mark Seen
                </button>
              </form>
            )}
            <DeleteUnitButton id={unit.id} />
          </div>
        </div>
        <form action={updateNotes} className="mt-3">
          <input type="hidden" name="id" value={unit.id} />
          <textarea
            name="notes"
            defaultValue={unit.notes || ''}
            rows={2}
            placeholder="Add internal notes..."
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
          />
          <button type="submit" className="mt-2 text-xs text-orange-400 hover:text-orange-300">
            Save Notes
          </button>
        </form>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-black text-white p-6 md:p-10">
      <Suspense fallback={null}>
        <InactivityRedirect />
      </Suspense>
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
          <div className="flex items-center gap-4">
            <img src="/images/logo.png" alt="Savage Chainsaws" className="h-14 w-14 object-contain" />
            <div>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                SAVAGE <span className="text-orange-500">CHAINSAWS</span>
              </h1>
              <p className="text-gray-400 mt-1 text-sm">Unit Tracking Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <form className="flex items-center gap-3">
              <select
                name="customer"
                defaultValue={selectedCustomerId || ''}
                className="bg-zinc-900 border border-zinc-700 text-white rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-orange-500"
              >
                <option value="">All Customers (Action Center)</option>
                {customers?.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button type="submit" className="bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
                Switch
              </button>
            </form>
            <AdminLogout />
          </div>
        </div>

        <Suspense fallback={null}>
          <LastViewedBanner customers={customers || []} />
        </Suspense>

        {currentCustomer && (
          <div className="mb-6">
            <p className="text-xl font-semibold text-orange-400">{currentCustomer.name}</p>
            <p className="text-sm text-gray-400">
              Total Units: <span className="text-white font-medium">{units?.length || 0}</span>
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-10">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Diagnosing</p>
            <p className="text-3xl font-bold text-orange-400">{diagnosing}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Needs Approval</p>
            <p className="text-3xl font-bold text-yellow-400">{needsApproval}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Repair Requested</p>
            <p className="text-3xl font-bold text-blue-300">{repairRequested}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <p className="text-xs text-gray-500 uppercase tracking-wider">In Repair</p>
            <p className="text-3xl font-bold text-blue-400">{inRepair}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Completed</p>
            <p className="text-3xl font-bold text-green-400">{completed}</p>
          </div>
        </div>

        {messages && messages.length > 0 && (
          <div className="bg-zinc-900 border border-orange-500/40 rounded-xl overflow-hidden mb-8">
            <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-orange-400">
                New Messages ({messages.length})
              </h2>
              <p className="text-xs text-gray-500">Customer inquiries</p>
            </div>
            <div className="divide-y divide-zinc-800">
              {messages.map((msg: any) => (
                <div key={msg.id} className="px-6 py-4 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-orange-400 font-medium">{msg.customer_name}</p>
                    <p className="text-sm text-gray-300 mt-1">{msg.message}</p>
                    <p className="text-xs text-gray-500 mt-2">{formatDate(msg.created_at)}</p>
                  </div>
                  <form action={markMessageRead}>
                    <input type="hidden" name="id" value={msg.id} />
                    <button type="submit" className="text-xs text-gray-400 hover:text-white whitespace-nowrap">
                      Mark Read
                    </button>
                  </form>
                </div>
              ))}
            </div>
          </div>
        )}

        {!selectedCustomerId && (
          <>
            {repairRequestedUnits.length > 0 && (
              <div className="bg-zinc-900 border border-blue-500/30 rounded-xl overflow-hidden mb-8">
                <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-blue-300">
                    Repair Requested ({repairRequestedUnits.length})
                  </h2>
                  <p className="text-xs text-blue-200/70">Heads up — unit is on its way</p>
                </div>
                <div className="divide-y divide-zinc-800">
                  {repairRequestedUnits.map(unit => (
                    <ActionCard key={unit.id} unit={unit} borderColor="border-blue-400">
                      <p className="text-sm text-blue-300">{unit.notes || 'Customer requested repair'}</p>
                    </ActionCard>
                  ))}
                </div>
              </div>
            )}

            {staleUnits.length > 0 && (
              <div className="bg-zinc-900 border border-red-500/30 rounded-xl overflow-hidden mb-8">
                <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-red-400">
                    Stagnant Units ({staleUnits.length})
                  </h2>
                  <p className="text-xs text-red-300/80">Over 7 days with no action</p>
                </div>
                <div className="divide-y divide-zinc-800">
                  {staleUnits.map(unit => (
                    <ActionCard key={unit.id} unit={unit} borderColor="border-red-500">
                      <p className="text-sm text-red-400 font-medium">
                        No action for {unit.daysSinceCheckIn} days
                      </p>
                    </ActionCard>
                  ))}
                </div>
              </div>
            )}

            {approvedDecisions.length > 0 && (
              <div className="bg-zinc-900 border border-green-500/30 rounded-xl overflow-hidden mb-8">
                <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-green-400">
                    Customer Approved ({approvedDecisions.length})
                  </h2>
                  <p className="text-xs text-green-300/80">Ready to work</p>
                </div>
                <div className="divide-y divide-zinc-800">
                  {approvedDecisions.map(unit => (
                    <ActionCard key={unit.id} unit={unit} borderColor="border-green-500">
                      <p className="text-sm text-green-300 font-medium">{unit.notes}</p>
                    </ActionCard>
                  ))}
                </div>
              </div>
            )}

            {deniedDecisions.length > 0 && (
              <div className="bg-zinc-900 border border-red-500/30 rounded-xl overflow-hidden mb-8">
                <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-red-400">
                    Customer Denied ({deniedDecisions.length})
                  </h2>
                </div>
                <div className="divide-y divide-zinc-800">
                  {deniedDecisions.map(unit => (
                    <ActionCard key={unit.id} unit={unit} borderColor="border-red-500">
                      <p className="text-sm text-red-300 font-medium">{unit.notes}</p>
                    </ActionCard>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-zinc-900 border border-yellow-500/30 rounded-xl overflow-hidden mb-8">
              <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-yellow-400">
                  Waiting on Customer ({waitingOnCustomer.length})
                </h2>
                <p className="text-xs text-yellow-300/80">Needs Approval</p>
              </div>
              {waitingOnCustomer.length === 0 ? (
                <p className="px-6 py-8 text-gray-500 text-sm">No units currently waiting on customer approval.</p>
              ) : (
                <div className="divide-y divide-zinc-800">
                  {waitingOnCustomer.map(unit => (
                    <ActionCard key={unit.id} unit={unit} borderColor="border-yellow-500">
                      <p className="text-sm text-yellow-300">Waiting for customer decision</p>
                    </ActionCard>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {selectedCustomerId && (
          <>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-8">
              <h2 className="text-lg font-semibold mb-4 text-orange-400">Check In New Unit</h2>
              <form action={addUnit} encType="multipart/form-data" className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input type="hidden" name="customer_id" value={selectedCustomerId} />
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Serial Number *</label>
                  <input name="serial" required className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" placeholder="Serial number" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Model</label>
                  <input name="model" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" placeholder="e.g. MS 462" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Problem Type</label>
                  <input name="problem_type" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" placeholder="Won't start, loss of power, etc." />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Check-in Date</label>
                  <input type="datetime-local" name="check_in_date" defaultValue={new Date().toISOString().slice(0, 16)} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Photo of Unit / Serial Plate</label>
                  <input
                    type="file"
                    name="photo"
                    accept="image/*"
                    capture="environment"
                    className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-orange-600 file:text-white hover:file:bg-orange-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">On phone this opens the camera</p>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Customer Notes (optional)</label>
                  <textarea name="customer_notes" rows={2} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" placeholder="What the customer said is wrong..." />
                </div>
                <div className="md:col-span-2">
                  <button type="submit" className="bg-orange-600 hover:bg-orange-500 text-white font-medium px-6 py-2.5 rounded-lg transition">
                    Check In Unit
                  </button>
                </div>
              </form>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-zinc-800">
                <h2 className="font-semibold text-orange-400">All Units</h2>
              </div>
              <div className="divide-y divide-zinc-800">
                {units?.length === 0 && (
                  <p className="px-6 py-8 text-gray-500 text-sm">No units for this customer yet.</p>
                )}
                {units?.map(unit => (
                  <details key={unit.id} className="group">
                    <summary className="px-6 py-4 cursor-pointer font-semibold hover:bg-zinc-800/50 transition flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <p className="font-medium text-lg">{unit.serial_number}</p>
                        <span className={`text-xs px-3 py-1 rounded-full font-medium ${
                          unit.status === 'Needs Approval' || unit.status === 'Repair Requested'
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : unit.status === 'Completed'
                            ? 'bg-green-500/20 text-green-400'
                            : unit.status === 'In Repair'
                            ? 'bg-blue-500/20 text-blue-400'
                            : unit.status === 'Registered'
                            ? 'bg-zinc-700 text-gray-300'
                            : 'bg-orange-500/20 text-orange-400'
                        }`}>
                          {unit.status}
                        </span>
                      </div>
                    </summary>
                    <div className="px-6 pb-5">
                      {unit.photo_url && (
                        <div className="mb-3">
                          <a href={unit.photo_url} target="_blank" rel="noreferrer">
                            <img src={unit.photo_url} alt="Check-in photo" className="h-32 w-32 object-cover rounded-lg border border-zinc-700" />
                          </a>
                          <p className="text-xs text-gray-500 mt-1">Tap photo to open full size</p>
                        </div>
                      )}
                      <form action={updateStatus} encType="multipart/form-data" className="mt-2 space-y-3">
                        <input type="hidden" name="id" value={unit.id} />
                        <div className="flex flex-wrap items-center gap-3">
                          <select
                            name="status"
                            defaultValue={unit.status}
                            key={unit.id + unit.status}
                            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-orange-500"
                          >
                            <option value="Registered">Registered</option>
                            <option value="Repair Requested">Repair Requested</option>
                            <option value="Diagnosing">Diagnosing</option>
                            <option value="Needs Approval">Needs Approval</option>
                            <option value="In Repair">In Repair</option>
                            <option value="Completed">Completed</option>
                          </select>
                          <button type="submit" className="bg-orange-600 hover:bg-orange-500 text-white text-sm px-4 py-1.5 rounded-lg transition">
                            Update
                          </button>
                          <DeleteUnitButton id={unit.id} />
                        </div>
                        <textarea
                          name="notes"
                          defaultValue={unit.notes || ''}
                          rows={2}
                          placeholder="Notes..."
                          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                        />
                        {(unit.status === 'Needs Approval' || unit.status === 'Completed') && (
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">
                              {unit.status === 'Needs Approval' ? 'Upload Invoice / Photo' : 'Upload Completion Photo'}
                            </label>
                            <input type="file" name="invoice" accept="image/*,.pdf" className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-orange-600 file:text-white hover:file:bg-orange-500" />
                          </div>
                        )}
                        {unit.invoice_url && (
                          <a href={unit.invoice_url} target="_blank" rel="noreferrer" className="text-xs text-orange-400 hover:text-orange-300">
                            View uploaded file →
                          </a>
                        )}
                      </form>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  )
}

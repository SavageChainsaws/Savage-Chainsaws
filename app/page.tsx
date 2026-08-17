import { supabase } from '../lib/supabase'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import InactivityRedirect from './components/InactivityRedirect'
import LastViewedBanner from './components/LastViewedBanner'

async function addUnit(formData: FormData) {
  'use server'

  const serial = formData.get('serial') as string
  const model = formData.get('model') as string
  const problemType = formData.get('problem_type') as string
  const customerNotes = formData.get('customer_notes') as string
  const customerId = formData.get('customer_id') as string
  const checkInDate = formData.get('check_in_date') as string

  const { error } = await supabase.from('units').insert({
    serial_number: serial,
    model: model || null,
    status: 'Diagnosing',
    problem_type: problemType || null,
    notes: customerNotes || null,
    customer_id: customerId,
    decision_seen: true,
    created_at: checkInDate ? new Date(checkInDate).toISOString() : new Date().toISOString()
  })

  if (error) {
    console.error('Error adding unit:', error.message)
    throw new Error(error.message)
  }

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
  notes: notes || null
}

  if (file && file.size > 0) {
    const fileName = `${id}-${Date.now()}-${file.name}`
    
    const { error: uploadError } = await supabase.storage
      .from('invoices')
      .upload(fileName, file)

    if (!uploadError) {
      const { data: { publicUrl } } = supabase.storage
        .from('invoices')
        .getPublicUrl(fileName)
      
      updateData.invoice_url = publicUrl
    }
  }

  const { error } = await supabase
    .from('units')
    .update(updateData)
    .eq('id', id)

  if (error) {
    console.error('Error updating status:', error.message)
    throw new Error(error.message)
  }

  revalidatePath('/')
}

async function markDecisionSeen(formData: FormData) {
  'use server'

  const id = formData.get('id') as string

  const { error } = await supabase
    .from('units')
    .update({ decision_seen: true })
    .eq('id', id)

  if (error) {
    console.error('Error marking seen:', error.message)
    throw new Error(error.message)
  }

  revalidatePath('/')
}

async function snoozeUnit(formData: FormData) {
  'use server'

  const id = formData.get('id') as string
  const days = Number(formData.get('days') || 7)

  const snoozeUntil = new Date()
  snoozeUntil.setDate(snoozeUntil.getDate() + days)

  const { error } = await supabase
    .from('units')
    .update({ 
      snoozed_until: snoozeUntil.toISOString(),
      decision_seen: true
    })
    .eq('id', id)

  if (error) {
    console.error('Error snoozing:', error.message)
    throw new Error(error.message)
  }

  revalidatePath('/')
}

async function updateNotes(formData: FormData) {
  'use server'

  const id = formData.get('id') as string
  const notes = formData.get('notes') as string

  const { error } = await supabase
    .from('units')
    .update({ notes })
    .eq('id', id)

  if (error) {
    console.error('Error updating notes:', error.message)
    throw new Error(error.message)
  }

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

  let unitsQuery = supabase
    .from('units')
    .select('*, customers(name)')
    .order('created_at', { ascending: false })

  if (selectedCustomerId) {
    unitsQuery = unitsQuery.eq('customer_id', selectedCustomerId)
  }

  const { data: units } = await unitsQuery

  const diagnosing = units?.filter(u => u.status === 'Diagnosing').length || 0
  const needsApproval = units?.filter(u => u.status === 'Needs Approval').length || 0
  const inRepair = units?.filter(u => u.status === 'In Repair').length || 0
  const completed = units?.filter(u => u.status === 'Completed').length || 0

  const currentCustomer = customers?.find(c => c.id === selectedCustomerId)

  const now = new Date()
  const isSnoozed = (u: any) => u.snoozed_until && new Date(u.snoozed_until) > now

  // ===== PRIORITY 1: Stale units (over 7 days, still Diagnosing) =====
  const staleUnits = (units?.filter(u => 
    u.status === 'Diagnosing' && !isSnoozed(u)
  ) || [])
    .map(u => {
      const daysSinceCheckIn = Math.floor(
        (Date.now() - new Date(u.created_at).getTime()) / (1000 * 60 * 60 * 24)
      )
      return { ...u, daysSinceCheckIn }
    })
    .filter(u => u.daysSinceCheckIn >= 7)
    .sort((a, b) => b.daysSinceCheckIn - a.daysSinceCheckIn)

  // ===== PRIORITY 2: Customer Decisions =====
const approvedDecisions = units?.filter(u => 
  !u.decision_seen && 
  !isSnoozed(u) &&
  u.status !== 'Needs Approval' &&
  u.notes && 
  u.notes.includes('Approved by:') &&
  !u.notes.includes('Denied')
) || []

const deniedDecisions = units?.filter(u => 
  !u.decision_seen && 
  !isSnoozed(u) &&
  u.status !== 'Needs Approval' &&
  u.notes && 
  u.notes.includes('Denied')
) || []
  // ===== PRIORITY 3: Waiting on Customer =====
  const waitingOnCustomer = units?.filter(u => 
    u.status === 'Needs Approval' && !isSnoozed(u)
  ) || []

  // ===== PRIORITY 4: Recent Diagnosing (under 7 days) =====
  const recentNoAction = (units?.filter(u => 
    u.status === 'Diagnosing' && !isSnoozed(u)
  ) || [])
    .map(u => {
      const daysSinceCheckIn = Math.floor(
        (Date.now() - new Date(u.created_at).getTime()) / (1000 * 60 * 60 * 24)
      )
      return { ...u, daysSinceCheckIn }
    })
    .filter(u => u.daysSinceCheckIn < 7)
    .sort((a, b) => b.daysSinceCheckIn - a.daysSinceCheckIn)

  function formatDate(dateString: string | null) {
    if (!dateString) return '—'
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
  }

function ActionCard({ 
  unit, 
  borderColor,
  children 
}: { 
  unit: any, 
  borderColor: string,
  children: React.ReactNode 
}) {
  return (
    <div className={`px-6 py-5 hover:bg-zinc-800/40 transition border-l-4 ${borderColor}`}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm text-gray-400">
              <span className="text-orange-400 font-medium">
                {unit.customers?.name || 'Unknown Customer'}
              </span>
            </p>
            <div className="flex items-center gap-3">
              <p className="text-xl font-semibold">{unit.serial_number}</p>
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                unit.status === 'Needs Approval' ? 'bg-yellow-500/20 text-yellow-400' :
                unit.status === 'Completed' ? 'bg-green-500/20 text-green-400' :
                unit.status === 'In Repair' ? 'bg-blue-500/20 text-blue-400' :
                'bg-orange-500/20 text-orange-400'
              }`}>
                {unit.status}
              </span>
            </div>
            {children}
              <div className="flex flex-wrap gap-4 text-xs text-gray-500 mt-2">
                <span>Checked in: {formatDate(unit.created_at)}</span>
                {unit.updated_at && unit.updated_at !== unit.created_at && (
                  <span>Updated: {formatDate(unit.updated_at)}</span>
                )}
                {unit.model && <span>Model: {unit.model}</span>}
              </div>
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
                <button
                  type="submit"
                  className="bg-zinc-700 hover:bg-zinc-600 text-white text-sm px-4 py-2 rounded-lg transition whitespace-nowrap"
                >
                  Delay 7 Days
                </button>
              </form>

              {(unit.notes?.includes('Approved by:') || unit.notes?.includes('Denied')) && (
                <form action={markDecisionSeen}>
                  <input type="hidden" name="id" value={unit.id} />
                  <button
                    type="submit"
                    className="bg-zinc-600 hover:bg-zinc-500 text-white text-sm px-4 py-2 rounded-lg transition whitespace-nowrap"
                  >
                    Mark as Seen
                  </button>
                </form>
              )}
            </div>
          </div>

          <form action={updateNotes} className="mt-1">
            <input type="hidden" name="id" value={unit.id} />
            <textarea
              name="notes"
              defaultValue={unit.notes || ''}
              rows={2}
              placeholder="Add internal notes..."
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
            />
            <button
              type="submit"
              className="mt-2 text-xs text-orange-400 hover:text-orange-300"
            >
              Save Notes
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-black text-white p-6 md:p-10">
    <InactivityRedirect />
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
          <div className="flex items-center gap-4">
            <img 
              src="/images/logo.png" 
              alt="Savage Chainsaws" 
              className="h-14 w-14 object-contain"
            />
            <div>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                SAVAGE <span className="text-orange-500">CHAINSAWS</span>
              </h1>
              <p className="text-gray-400 mt-1 text-sm">Unit Tracking Dashboard</p>
            </div>
          </div>

          <form className="flex items-center gap-3">
            <select
              name="customer"
              defaultValue={selectedCustomerId || ''}
              className="bg-zinc-900 border border-zinc-700 text-white rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-orange-500"
            >
              <option value="">All Customers (Action Center)</option>
              {customers?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
            >
              Switch
            </button>
          </form>
        </div>

        {currentCustomer && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-8 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Current Customer</p>
              <p className="text-xl font-semibold text-orange-400">{currentCustomer.name}</p>
            </div>
            <p className="text-sm text-gray-400">
              Total Units: <span className="text-white font-medium">{units?.length || 0}</span>
            </p>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Diagnosing</p>
            <p className="text-3xl font-bold text-orange-400">{diagnosing}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Needs Approval</p>
            <p className="text-3xl font-bold text-yellow-400">{needsApproval}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">In Repair</p>
            <p className="text-3xl font-bold text-blue-400">{inRepair}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Completed</p>
            <p className="text-3xl font-bold text-green-400">{completed}</p>
          </div>
        </div>

        {/* ==================== ACTION CENTER ==================== */}
        {!selectedCustomerId && (
          <div className="space-y-8 mb-10">
    <LastViewedBanner customers={customers || []} />

            {/* 1. STALE UNITS (RED) - TOP PRIORITY */}
            {staleUnits.length > 0 && (
              <div className="bg-zinc-900 border border-red-500/40 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-red-500/10">
                  <h2 className="text-lg font-semibold text-red-400">
                    ⚠ Stagnant Units ({staleUnits.length})
                  </h2>
                  <p className="text-xs text-red-300/80">Over 7 days with no action</p>
                </div>
                <div className="divide-y divide-zinc-800">
                  {staleUnits.map((unit) => (
                    <ActionCard key={unit.id} unit={unit} borderColor="border-red-500">
                      <p className="text-sm text-red-400 font-medium">
                        No action for {unit.daysSinceCheckIn} days
                      </p>
                    </ActionCard>
                  ))}
                </div>
              </div>
            )}

            {/* 2. CUSTOMER APPROVED (GREEN) */}
            {approvedDecisions.length > 0 && (
              <div className="bg-zinc-900 border border-green-500/40 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-green-500/10">
                  <h2 className="text-lg font-semibold text-green-400">
                    Customer Approved ({approvedDecisions.length})
                  </h2>
                  <p className="text-xs text-green-300/80">Money — ready to work</p>
                </div>
                <div className="divide-y divide-zinc-800">
                  {approvedDecisions.map((unit) => (
                    <ActionCard key={unit.id} unit={unit} borderColor="border-green-500">
                      <p className="text-sm text-green-300 font-medium">{unit.notes}</p>
                    </ActionCard>
                  ))}
                </div>
              </div>
            )}

            {/* 3. CUSTOMER DENIED (RED) */}
            {deniedDecisions.length > 0 && (
              <div className="bg-zinc-900 border border-red-500/40 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-red-500/10">
                  <h2 className="text-lg font-semibold text-red-400">
                    Customer Denied ({deniedDecisions.length})
                  </h2>
                  <p className="text-xs text-red-300/80">Diagnosis fee applies</p>
                </div>
                <div className="divide-y divide-zinc-800">
                  {deniedDecisions.map((unit) => (
                    <ActionCard key={unit.id} unit={unit} borderColor="border-red-500">
                      <p className="text-sm text-red-300 font-medium">{unit.notes}</p>
                    </ActionCard>
                  ))}
                </div>
              </div>
            )}

            {/* 4. WAITING ON CUSTOMER (YELLOW) */}
            <div className="bg-zinc-900 border border-yellow-500/30 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-yellow-400">
                  Waiting on Customer ({waitingOnCustomer.length})
                </h2>
                <p className="text-xs text-gray-500">Needs Approval</p>
              </div>
              {waitingOnCustomer.length === 0 ? (
                <p className="px-6 py-8 text-gray-500 text-sm">No units currently waiting on customer approval.</p>
              ) : (
                <div className="divide-y divide-zinc-800">
                  {waitingOnCustomer.map((unit) => (
                    <ActionCard key={unit.id} unit={unit} borderColor="border-yellow-500">
                      <p className="text-sm text-yellow-300">Waiting for customer decision</p>
                      {unit.invoice_url && (
                        <a 
                          href={unit.invoice_url} 
                          target="_blank" 
                          className="inline-block mt-1 text-sm text-orange-400 hover:underline"
                        >
                          View Invoice →
                        </a>
                      )}
                    </ActionCard>
                  ))}
                </div>
              )}
            </div>

            {/* 5. RECENT NO ACTION (ORANGE) */}
            <div className="bg-zinc-900 border border-orange-500/30 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-orange-400">
                  Recently Checked In ({recentNoAction.length})
                </h2>
                <p className="text-xs text-gray-500">Still Diagnosing</p>
              </div>
              {recentNoAction.length === 0 ? (
                <p className="px-6 py-8 text-gray-500 text-sm">No recent units waiting for diagnosis.</p>
              ) : (
                <div className="divide-y divide-zinc-800">
                  {recentNoAction.map((unit) => (
                    <ActionCard key={unit.id} unit={unit} borderColor="border-orange-500">
                      <p className="text-sm text-orange-300">
                        ○ Still diagnosing — {unit.daysSinceCheckIn} day{unit.daysSinceCheckIn !== 1 ? 's' : ''} old
                      </p>
                    </ActionCard>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================== ADD NEW UNIT ==================== */}
        {selectedCustomerId && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-8">
            <h2 className="text-lg font-semibold mb-4 text-orange-400">Add New Unit</h2>
            
            <form action={addUnit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Serial Number *</label>
                <input 
                  name="serial" 
                  required 
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" 
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Model</label>
                <input 
                  name="model" 
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" 
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Problem Type</label>
                <input 
                  name="problem_type" 
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" 
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Check-in Date</label>
                <input 
                  type="datetime-local"
                  name="check_in_date"
                  defaultValue={new Date().toISOString().slice(0, 16)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" 
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Customer Notes (optional)</label>
                <textarea 
                  name="customer_notes" 
                  rows={2} 
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" 
                />
              </div>

              <input type="hidden" name="customer_id" value={selectedCustomerId} />

              <div className="md:col-span-2">
                <button 
                  type="submit" 
                  className="bg-orange-600 hover:bg-orange-500 text-white font-medium px-6 py-2.5 rounded-lg transition"
                >
                  Add Unit
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ==================== ALL UNITS (specific customer) ==================== */}
        {selectedCustomerId && (
          <details className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden" open>
            <summary className="px-6 py-4 cursor-pointer font-semibold text-orange-400 hover:bg-zinc-800/50 transition">
              All Units ({units?.length || 0})
            </summary>

            <div className="px-6 pb-6 space-y-4">
              {units?.length === 0 ? (
                <p className="text-gray-500 text-sm">No units yet.</p>
              ) : (
                units?.map((unit) => (
                  <div key={unit.id} className="bg-zinc-800/60 border border-zinc-700/50 rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium text-lg">{unit.serial_number}</p>
                        <p className="text-sm text-gray-400">
                          {unit.model || 'No model'} • {unit.problem_type || 'No problem listed'}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          Checked in: {formatDate(unit.created_at)}
                        </p>
                      </div>
                      <span className={`text-xs px-3 py-1 rounded-full font-medium ${
                        unit.status === 'Needs Approval' ? 'bg-yellow-500/20 text-yellow-400' :
                        unit.status === 'Completed' ? 'bg-green-500/20 text-green-400' :
                        unit.status === 'In Repair' ? 'bg-blue-500/20 text-blue-400' :
                        'bg-orange-500/20 text-orange-400'
                      }`}>
                        {unit.status}
                      </span>
                    </div>

                    <form action={updateStatus} className="mt-4 space-y-3">
                      <input type="hidden" name="id" value={unit.id} />
                      
                      <div className="flex items-center gap-3">
                        <select
                          key={unit.id + unit.status}
                          name="status"
                          defaultValue={unit.status}
                          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-orange-500"
                        >
                          <option value="Diagnosing">Diagnosing</option>
                          <option value="Needs Approval">Needs Approval</option>
                          <option value="In Repair">In Repair</option>
                          <option value="Completed">Completed</option>
                        </select>
                        <button 
                          type="submit" 
                          className="bg-orange-600 hover:bg-orange-500 text-white text-sm px-4 py-1.5 rounded-lg transition"
                        >
                          Update
                        </button>
                      </div>

                      {(unit.status === 'Diagnosing' || unit.status === 'Needs Approval' || unit.status === 'Completed') && (
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Notes</label>
                          <textarea
                            name="notes"
                            defaultValue={unit.notes || ''}
                            rows={2}
                            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                            placeholder="Add notes..."
                          />
                        </div>
                      )}

                      {(unit.status === 'Needs Approval' || unit.status === 'Completed') && (
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">
                            {unit.status === 'Needs Approval' ? 'Upload Invoice / Photo' : 'Upload Completion Photo'}
                          </label>
                          <input
                            type="file"
                            name="invoice"
                            accept="image/*,.pdf"
                            className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-orange-600 file:text-white hover:file:bg-orange-500"
                          />
                        </div>
                      )}
                    </form>

                    {unit.invoice_url && (
                      <div className="mt-3">
                        <a 
                          href={unit.invoice_url} 
                          target="_blank" 
                          className="text-sm text-orange-400 hover:underline"
                        >
                          View uploaded file →
                        </a>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </details>
        )}
      </div>
    </main>
  )
}
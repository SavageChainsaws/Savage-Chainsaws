'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Unit = {
  id: string
  serial_number: string
  model: string | null
  status: string
  notes: string | null
  problem_type: string | null
  equipment_type: string | null
  photo_url: string | null
  invoice_url: string | null
  created_at: string
  is_priority: boolean | null
  customer_id: string
}

type Customer = {
  id: string
  name: string
  email: string | null
}

export default function CustomerPortal() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [units, setUnits] = useState<Unit[]>([])
  const [showCheckIn, setShowCheckIn] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // Check-in form state
  const [serial, setSerial] = useState('')
  const [model, setModel] = useState('')
  const [unitType, setUnitType] = useState('Chainsaw')
  const [problem, setProblem] = useState('')
  const [scheduled, setScheduled] = useState('')
  const [notes, setNotes] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    setMessage(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    setUserEmail(user.email ?? null)

    // Find customer by email
    const { data: cust } = await supabase
      .from('customers')
      .select('id, name, email')
      .ilike('email', user.email ?? '')
      .maybeSingle()

    if (!cust) {
      setCustomer(null)
      setUnits([])
      setLoading(false)
      return
    }

    setCustomer(cust)

    const { data: unitData } = await supabase
      .from('units')
      .select('*')
      .eq('customer_id', cust.id)
      .order('created_at', { ascending: false })

    setUnits(unitData || [])
    setLoading(false)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  async function handleCheckIn(e: React.FormEvent) {
    e.preventDefault()
    if (!customer || !serial.trim()) return

    setSubmitting(true)
    setMessage(null)

    try {
      let photoUrl: string | null = null

      if (photoFile) {
        const fileName = `${customer.id}-${Date.now()}-${photoFile.name}`
        const { error: uploadError } = await supabase.storage
          .from('invoices')
          .upload(fileName, photoFile, {
            contentType: photoFile.type || 'image/jpeg',
            upsert: false,
          })

        if (!uploadError) {
          const { data: { publicUrl } } = supabase.storage
            .from('invoices')
            .getPublicUrl(fileName)
          photoUrl = publicUrl
        }
      }

      const createdAt = scheduled
        ? new Date(scheduled).toISOString()
        : new Date().toISOString()

      const { error } = await supabase.from('units').insert({
        serial_number: serial.trim(),
        model: model.trim() || null,
        equipment_type: unitType || null,
        problem_type: problem.trim() || null,
        notes: notes.trim() || null,
        photo_url: photoUrl,
        customer_id: customer.id,
        status: 'Repair Requested',
        decision_seen: true,
        created_at: createdAt,
      })

      if (error) {
        console.error(error)
        setMessage('Could not check in this unit. Let Jesse know if this keeps happening.')
        setSubmitting(false)
        return
      }

      // Reset form
      setSerial('')
      setModel('')
      setUnitType('Chainsaw')
      setProblem('')
      setScheduled('')
      setNotes('')
      setPhotoFile(null)
      setShowCheckIn(false)
      setMessage('Unit checked in. Jesse will see it shortly.')
      await loadData()
    } catch (err) {
      console.error(err)
      setMessage('Could not check in this unit. Let Jesse know if this keeps happening.')
    }

    setSubmitting(false)
  }

  async function handleDecision(unitId: string, decision: 'approve' | 'upgrade' | 'equivalent' | 'deny') {
    if (!customer) return

    const name = customer.name || userEmail || 'Customer'
    let status = 'In Repair'
    let note = ''

    if (decision === 'approve') {
      status = 'In Repair'
      note = `Approved by ${name}`
    } else if (decision === 'upgrade') {
      status = 'In Repair'
      note = `Upgrade requested by ${name}`
    } else if (decision === 'equivalent') {
      status = 'In Repair'
      note = `Equivalent replacement requested by ${name}`
    } else {
      status = 'Completed'
      note = `Denied by ${name} — diagnosis fee $49.99 will apply`
    }

    const { data: existing } = await supabase
      .from('units')
      .select('notes, history')
      .eq('id', unitId)
      .single()

    const historyLine = `${new Date().toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })} — ${note}`

    const { error } = await supabase
      .from('units')
      .update({
        status,
        notes: existing?.notes ? `${note}\n${existing.notes}` : note,
        decision_seen: false,
        history: existing?.history
          ? `${historyLine}\n${existing.history}`
          : historyLine,
      })
      .eq('id', unitId)

    if (error) {
      console.error(error)
      setMessage('Could not save decision. Try again.')
      return
    }

    setMessage(
      decision === 'deny'
        ? 'Repair denied. A $49.99 diagnosis fee applies.'
        : 'Decision saved. Jesse has been notified.'
    )
    await loadData()
  }

  const total = units.length
  const needsApproval = units.filter(u => u.status === 'Needs Approval').length
  const inProgress = units.filter(u =>
    ['Diagnosing', 'In Repair', 'Repair Requested'].includes(u.status)
  ).length
  const completed = units.filter(u =>
    ['Completed', 'Ready for Pickup'].includes(u.status)
  ).length

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </main>
    )
  }

  if (!customer) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white p-6">
        <div className="max-w-lg mx-auto mt-20 text-center space-y-4">
          <img src="/images/logo.png" alt="Savage Chainsaws" className="h-16 w-16 mx-auto object-contain" />
          <h1 className="text-2xl font-bold">
            SAVAGE <span className="text-orange-500">CHAINSAWS</span>
          </h1>
          <p className="text-gray-400">
            No customer account is linked to <span className="text-white">{userEmail}</span> yet.
          </p>
          <p className="text-sm text-gray-500">
            Ask Jesse to add your email to your company record, then refresh.
          </p>
          <button
            onClick={handleLogout}
            className="mt-4 border border-zinc-700 rounded-lg px-4 py-2 text-sm hover:bg-zinc-800"
          >
            Log out
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 px-4 sm:px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/images/logo.png" alt="Savage Chainsaws" className="h-10 w-10 object-contain" />
            <div>
              <p className="font-bold text-lg leading-tight">
                Savage <span className="text-orange-500">Chainsaws</span>
              </p>
              <p className="text-xs text-gray-500">Customer Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="text-right hidden sm:block">
              <p className="font-medium">{customer.name}</p>
              <p className="text-xs text-gray-500">{userEmail}</p>
            </div>
            <button
              onClick={handleLogout}
              className="border border-zinc-700 rounded-lg px-3 py-1.5 hover:bg-zinc-800 transition"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase">Total Units</p>
            <p className="text-2xl font-bold text-orange-400">{total}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase">Needs Approval</p>
            <p className="text-2xl font-bold text-yellow-400">{needsApproval}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase">In Progress</p>
            <p className="text-2xl font-bold text-blue-400">{inProgress}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase">Completed</p>
            <p className="text-2xl font-bold text-green-400">{completed}</p>
          </div>
        </div>

        {message && (
          <div className="bg-zinc-900 border border-orange-500/40 rounded-xl px-4 py-3 text-sm text-orange-300">
            {message}
          </div>
        )}

        {/* Check-in toggle */}
        <div className="flex justify-end">
          <button
            onClick={() => setShowCheckIn(!showCheckIn)}
            className="bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            {showCheckIn ? 'Close Check-In' : 'Check In a Unit'}
          </button>
        </div>

        {/* Check-in form */}
        {showCheckIn && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-orange-400 mb-1">Check In a Unit</h2>
            <p className="text-sm text-gray-500 mb-4">
              Tell us what’s coming in. Jesse can correct any details after pickup.
            </p>
            <form onSubmit={handleCheckIn} className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Serial Number *</label>
                <input
                  required
                  value={serial}
                  onChange={e => setSerial(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  placeholder="Serial number"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Model</label>
                <input
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  placeholder="e.g. MS 462"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Unit Type</label>
                <select
                  value={unitType}
                  onChange={e => setUnitType(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                >
                  <option>Chainsaw</option>
                  <option>Pole Saw</option>
                  <option>String Trimmer</option>
                  <option>Hedge Trimmer</option>
                  <option>Blower</option>
                  <option>Backpack Blower</option>
                  <option>Riding Mower</option>
                  <option>Walk-Behind Mower</option>
                  <option>Edger</option>
                  <option>Cutquik</option>
                  <option>Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">What’s wrong</label>
                <input
                  value={problem}
                  onChange={e => setProblem(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  placeholder="Won't start, loss of power, etc."
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Scheduled drop-off (optional)</label>
                <input
                  type="datetime-local"
                  value={scheduled}
                  onChange={e => setScheduled(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Photo of unit / serial plate</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={e => setPhotoFile(e.target.files?.[0] || null)}
                  className="w-full text-sm text-gray-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-orange-600 file:text-white"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Notes</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  placeholder="Anything else we should know..."
                />
              </div>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-orange-600 hover:bg-orange-500 disabled:opacity-60 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition"
                >
                  {submitting ? 'Checking in...' : 'Check In Unit'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Unit list */}
        <div>
          <h2 className="text-lg font-semibold text-orange-400 mb-3">Your Units</h2>
          {units.length === 0 ? (
            <p className="text-gray-500 text-sm">No units yet. Use Check In a Unit to add one.</p>
          ) : (
            <div className="space-y-3">
              {units.map(unit => (
                <div
                  key={unit.id}
                  className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex gap-4"
                >
                  {/* Photo */}
                  <div className="shrink-0">
                    {unit.photo_url ? (
                      <a href={unit.photo_url} target="_blank" rel="noreferrer">
                        <img
                          src={unit.photo_url}
                          alt=""
                          className="h-16 w-16 sm:h-20 sm:w-20 object-cover rounded-lg border border-zinc-700"
                        />
                      </a>
                    ) : (
                      <div className="h-16 w-16 sm:h-20 sm:w-20 rounded-lg border border-zinc-700 bg-zinc-800" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <p className="font-semibold text-lg">{unit.serial_number}</p>
                      {unit.is_priority && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-orange-500 text-black">
                          PRIORITY
                        </span>
                      )}
                      <span
                        className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                          unit.status === 'Needs Approval'
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : unit.status === 'Completed' || unit.status === 'Ready for Pickup'
                            ? 'bg-green-500/20 text-green-400'
                            : unit.status === 'In Repair'
                            ? 'bg-blue-500/20 text-blue-400'
                            : 'bg-orange-500/20 text-orange-400'
                        }`}
                      >
                        {unit.status}
                        {unit.status === 'Needs Approval' && ' 🚩'}
                      </span>
                    </div>

                    <p className="text-sm text-gray-400">
                      {unit.model || '—'}
                      {unit.equipment_type ? ` · ${unit.equipment_type}` : ''}
                    </p>
                    {unit.problem_type && (
                      <p className="text-sm text-gray-500 mt-0.5">Problem: {unit.problem_type}</p>
                    )}
                    {unit.notes && (
                      <p className="text-sm text-gray-400 mt-1 line-clamp-2">{unit.notes}</p>
                    )}
                    {unit.invoice_url && (
                      <a
                        href={unit.invoice_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block mt-2 text-xs text-orange-400 hover:text-orange-300"
                      >
                        View invoice / photo →
                      </a>
                    )}

                    {/* Decision buttons when Needs Approval */}
                    {unit.status === 'Needs Approval' && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={() => handleDecision(unit.id, 'approve')}
                          className="bg-green-600 hover:bg-green-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
                        >
                          Approve Repair
                        </button>
                        <button
                          onClick={() => handleDecision(unit.id, 'upgrade')}
                          className="bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
                        >
                          Upgrade
                        </button>
                        <button
                          onClick={() => handleDecision(unit.id, 'equivalent')}
                          className="bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
                        >
                          Same / Equivalent
                        </button>
                        <button
                          onClick={() => {
                            if (
                              confirm(
                                'Deny this repair? A $49.99 diagnosis fee will be charged.'
                              )
                            ) {
                              handleDecision(unit.id, 'deny')
                            }
                          }}
                          className="bg-red-700 hover:bg-red-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
                        >
                          Deny ($49.99 diag)
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
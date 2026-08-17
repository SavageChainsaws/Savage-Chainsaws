'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function CustomerPortal() {
  const router = useRouter()
  const [units, setUnits] = useState<any[]>([])
  const [customer, setCustomer] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)

  // Add Unit form state
  const [serial, setSerial] = useState('')
  const [model, setModel] = useState('')
  const [notes, setNotes] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    checkUser()
  }, [])

  async function checkUser() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    let { data: customerData } = await supabase
      .from('customers')
      .select('*')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    if (!customerData) {
      const { data: byEmail } = await supabase
        .from('customers')
        .select('*')
        .eq('email', user.email)
        .maybeSingle()

      if (byEmail) {
        await supabase
          .from('customers')
          .update({ auth_user_id: user.id })
          .eq('id', byEmail.id)
        customerData = byEmail
      }
    }

    if (!customerData) {
      setLoading(false)
      return
    }

    setCustomer(customerData)

    const { data: unitsData } = await supabase
      .from('units')
      .select('*')
      .eq('customer_id', customerData.id)
      .order('created_at', { ascending: false })

    setUnits(unitsData || [])
    setLoading(false)
  }

  async function handleAddUnit(e: React.FormEvent) {
    e.preventDefault()
    if (!customer) return
    setAdding(true)

    await supabase.from('units').insert({
      customer_id: customer.id,
      serial_number: serial,
      model: model || null,
      notes: notes || null,
      status: 'Registered',
      problem_type: notes || 'Registered unit',
    })

    setSerial('')
    setModel('')
    setNotes('')
    setShowAddForm(false)
    setAdding(false)
    checkUser()
  }

  async function requestRepair(unitId: string) {
    const reason = prompt('What is the issue or reason for the repair request?')
    if (!reason) return

    await supabase
      .from('units')
      .update({
        status: 'Repair Requested',
        notes: reason,
        problem_type: reason,
      })
      .eq('id', unitId)

    checkUser()
  }

  async function handleDecision(unitId: string, decision: string, name: string) {
    const note =
      decision === 'Deny'
        ? `Denied by ${name} — Diagnosis fee of $49.99 will be charged`
        : `${decision} — Approved by: ${name}`

    await supabase
      .from('units')
      .update({
        notes: note,
        status: decision === 'Deny' ? 'Completed' : 'In Repair',
        decision_seen: false,
      })
      .eq('id', unitId)

    checkUser()
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </main>
    )
  }

  if (!customer) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-gray-400 mb-4">No customer account linked yet.</p>
          <button onClick={handleLogout} className="text-orange-400 underline">
            Log out
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-black text-white p-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <img src="/images/logo.png" alt="Logo" className="h-10 w-10" />
            <div>
              <h1 className="text-xl font-bold">
                SAVAGE <span className="text-orange-500">CHAINSAWS</span>
              </h1>
              <p className="text-sm text-gray-400">{customer.name}</p>
            </div>
          </div>
          <button onClick={handleLogout} className="text-sm text-gray-400 hover:text-white">
            Log out
          </button>
        </div>

        {/* Add Unit Button */}
        <div className="mb-6">
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition"
          >
            {showAddForm ? 'Cancel' : '+ Add Unit'}
          </button>
        </div>

        {/* Add Unit Form */}
        {showAddForm && (
          <form onSubmit={handleAddUnit} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-8 space-y-4">
            <h3 className="font-semibold">Register a Unit</h3>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Serial Number *</label>
              <input
                required
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-orange-500"
                placeholder="Serial number"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Model</label>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-orange-500"
                placeholder="e.g. MS 462"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-orange-500"
                placeholder="Any details about this unit..."
              />
            </div>
            <button
              type="submit"
              disabled={adding}
              className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition"
            >
              {adding ? 'Adding...' : 'Add Unit'}
            </button>
          </form>
        )}

        {/* Units List */}
        <h2 className="text-lg font-semibold mb-4">Your Units</h2>

        {units.length === 0 ? (
          <p className="text-gray-500">No units registered yet.</p>
        ) : (
          <div className="space-y-4">
            {units.map((unit) => (
              <div
                key={unit.id}
                className={`bg-zinc-900 border rounded-xl p-5 ${
                  unit.status === 'Needs Approval' || unit.status === 'Repair Requested'
                    ? 'border-yellow-500/50'
                    : 'border-zinc-800'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-lg font-semibold">{unit.serial_number}</p>
                      {(unit.status === 'Needs Approval' || unit.status === 'Repair Requested') && (
                        <span className="text-red-500 text-lg">⚑</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-400">
                      {unit.model || 'No model'} • {unit.problem_type || '—'}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Status: <span className="text-orange-400">{unit.status}</span>
                    </p>
                  </div>
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                      unit.status === 'Needs Approval' || unit.status === 'Repair Requested'
                        ? 'bg-yellow-500/20 text-yellow-400'
                        : unit.status === 'Completed'
                        ? 'bg-green-500/20 text-green-400'
                        : unit.status === 'In Repair'
                        ? 'bg-blue-500/20 text-blue-400'
                        : unit.status === 'Registered'
                        ? 'bg-zinc-700 text-gray-300'
                        : 'bg-orange-500/20 text-orange-400'
                    }`}
                  >
                    {unit.status}
                  </span>
                </div>

                {unit.notes && (
                  <p className="mt-3 text-sm text-gray-300 bg-zinc-800 rounded-lg p-3">
                    {unit.notes}
                  </p>
                )}

                {unit.invoice_url && (
                  <a
                    href={unit.invoice_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-3 text-sm text-orange-400 hover:text-orange-300"
                  >
                    View Invoice / Photo →
                  </a>
                )}

                {/* Request Repair button for Registered units */}
                {unit.status === 'Registered' && (
                  <div className="mt-4">
                    <button
                      onClick={() => requestRepair(unit.id)}
                      className="text-sm bg-orange-600/20 text-orange-400 hover:bg-orange-600/30 px-4 py-2 rounded-lg transition"
                    >
                      Request Repair
                    </button>
                  </div>
                )}

                {/* Approval buttons */}
                {unit.status === 'Needs Approval' && (
                  <div className="mt-4 pt-4 border-t border-zinc-800">
                    <p className="text-sm text-gray-400 mb-3">Your decision:</p>
                    <div className="flex flex-wrap gap-2">
                      {['Approve Repair', 'Equivalent Replacement', 'Upgrade', 'Deny'].map(
                        (decision) => (
                          <button
                            key={decision}
                            onClick={() => {
                              const name = prompt('Type your name to confirm:')
                              if (name && name.trim()) {
                                handleDecision(unit.id, decision, name.trim())
                              }
                            }}
                            className={`text-sm px-3 py-1.5 rounded-lg transition ${
                              decision === 'Deny'
                                ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
                                : 'bg-orange-600/20 text-orange-400 hover:bg-orange-600/30'
                            }`}
                          >
                            {decision}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
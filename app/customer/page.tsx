'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function CustomerPage() {
  const [user, setUser] = useState<any>(null)
  const [units, setUnits] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [approverName, setApproverName] = useState('')
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        router.push('/login')
        return
      }

      setUser(user)

      const { data: customer } = await supabase
        .from('customers')
        .select('id')
        .eq('email', user.email)
        .single()

      if (!customer) {
        setUnits([])
        setLoading(false)
        return
      }

      const { data } = await supabase
        .from('units')
        .select('*')
        .eq('customer_id', customer.id)
        .order('created_at', { ascending: false })

      setUnits(data || [])
      setLoading(false)
    }

    load()
  }, [router])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  async function handleDecision(unitId: string, choice: string) {
    if (!approverName.trim()) {
      alert('Please enter your name before making a decision.')
      return
    }

    const decisionText = `${choice} — Approved by: ${approverName.trim()}`

    let newStatus = 'Completed'
    if (choice === 'Approve Repair') {
      newStatus = 'In Repair'
    }

    const { error } = await supabase
      .from('units')
      .update({
        status: newStatus,
        notes: decisionText
      })
      .eq('id', unitId)

    if (error) {
      alert('Error saving decision: ' + error.message)
      return
    }

    // Refresh the list
    setUnits(prev =>
      prev.map(u =>
        u.id === unitId
          ? { ...u, status: newStatus, notes: decisionText }
          : u
      )
    )

    setSelectedUnit(null)
    setApproverName('')
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <p>Loading...</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-black text-white p-6 md:p-10">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <img 
              src="/images/logo.png" 
              alt="Savage Chainsaws" 
              className="h-12 w-12 object-contain"
            />
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                SAVAGE <span className="text-orange-500">CHAINSAWS</span>
              </h1>
              <p className="text-gray-400 text-sm">Customer Portal</p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="bg-zinc-800 hover:bg-zinc-700 text-white text-sm px-4 py-2 rounded-lg transition"
          >
            Log Out
          </button>
        </div>

        {/* Logged in as */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-8">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Logged in as</p>
          <p className="text-lg font-medium">{user?.email}</p>
        </div>

        {/* Units */}
        <h2 className="text-xl font-semibold mb-4 text-orange-400">Your Units</h2>

        {units.length === 0 ? (
          <p className="text-gray-500">No units found.</p>
        ) : (
          <div className="space-y-4">
            {units.map((unit) => (
              <div 
                key={unit.id} 
                className={`bg-zinc-900 border rounded-xl p-5 ${
                  unit.status === 'Needs Approval' 
                    ? 'border-yellow-500/60' 
                    : 'border-zinc-800'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {unit.status === 'Needs Approval' && (
                      <div className="mt-1 text-red-500 text-xl" title="Needs your approval">
                        ⚑
                      </div>
                    )}
                    <div>
                      <p className="font-medium text-lg">{unit.serial_number}</p>
                      <p className="text-sm text-gray-400">
                        {unit.model || 'No model'} • {unit.problem_type || 'No problem listed'}
                      </p>
                    </div>
                  </div>

                  <span className={`text-xs px-3 py-1 rounded-full font-medium ${
                    unit.status === 'Needs Approval' 
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

                {unit.notes && (
                  <p className="mt-3 text-sm text-gray-300 bg-zinc-800/60 rounded-lg px-3 py-2">
                    {unit.notes}
                  </p>
                )}

                {unit.invoice_url && (
                  <a
                    href={unit.invoice_url}
                    target="_blank"
                    className="inline-block mt-3 text-sm text-orange-400 hover:underline"
                  >
                    View Invoice / Photo →
                  </a>
                )}

                {/* Approval section */}
                {unit.status === 'Needs Approval' && (
                  <div className="mt-5 pt-4 border-t border-zinc-700">
                    {selectedUnit === unit.id ? (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Your Name (required)</label>
                          <input
                            type="text"
                            value={approverName}
                            onChange={(e) => setApproverName(e.target.value)}
                            placeholder="Type your full name"
                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                          />
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => handleDecision(unit.id, 'Approve Repair')}
                            className="bg-green-600 hover:bg-green-500 text-white text-sm px-4 py-2 rounded-lg transition"
                          >
                            Approve Repair
                          </button>
                          <button
                            onClick={() => handleDecision(unit.id, 'Equivalent Replacement')}
                            className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg transition"
                          >
                            Equivalent Replacement
                          </button>
                          <button
                            onClick={() => handleDecision(unit.id, 'Upgrade')}
                            className="bg-orange-600 hover:bg-orange-500 text-white text-sm px-4 py-2 rounded-lg transition"
                          >
                            Upgrade
                          </button>
                          <button
                            onClick={() => {
                              if (confirm('Denying the repair will result in a $49.99 diagnosis fee. Do you want to continue?')) {
                                handleDecision(unit.id, 'Denied - Diagnosis Fee $49.99')
                              }
                            }}
                            className="bg-red-700 hover:bg-red-600 text-white text-sm px-4 py-2 rounded-lg transition"
                          >
                            Deny
                          </button>
                          <button
                            onClick={() => {
                              setSelectedUnit(null)
                              setApproverName('')
                            }}
                            className="bg-zinc-700 hover:bg-zinc-600 text-white text-sm px-4 py-2 rounded-lg transition"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setSelectedUnit(unit.id)}
                        className="bg-yellow-600 hover:bg-yellow-500 text-black font-medium text-sm px-5 py-2 rounded-lg transition"
                      >
                        Make Decision
                      </button>
                    )}
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
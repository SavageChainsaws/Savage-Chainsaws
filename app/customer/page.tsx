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
  invoice_url: string | null
  created_at: string
  customer_id: string
  decision?: string | null
  decision_by?: string | null
  decision_seen?: boolean | null
}

type Customer = {
  id: string
  name: string
  email: string | null
}

export default function CustomerPortal() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [userEmail, setUserEmail] = useState('')
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [units, setUnits] = useState<Unit[]>([])
  const [decisionName, setDecisionName] = useState('')

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        router.push('/login')
        return
      }

      setUserEmail(session.user.email || '')

      const { data: cust } = await supabase
        .from('customers')
        .select('*')
        .eq('email', session.user.email)
        .single()

      if (!cust) {
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

    load()
  }, [router])

  async function handleDecision(unitId: string, decision: string) {
    if (!decisionName.trim()) {
      alert('Please type your name before approving or denying.')
      return
    }

    await supabase
      .from('units')
      .update({
        decision,
        decision_by: decisionName.trim(),
        decision_seen: false,
        status: decision === 'approved' ? 'In Repair' : 'Diagnosing'
      })
      .eq('id', unitId)

    if (customer) {
      const { data } = await supabase
        .from('units')
        .select('*')
        .eq('customer_id', customer.id)
        .order('created_at', { ascending: false })
      setUnits(data || [])
    }

    setDecisionName('')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
        <p className="text-orange-400 text-xl">Loading...</p>
      </div>
    )
  }

  if (!customer) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-xl mb-4">No customer account found for {userEmail}</p>
          <p className="text-gray-400">Contact Savage Chainsaws to get set up.</p>
        </div>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/images/logo.png" alt="Savage Chainsaws" className="h-10 w-auto" />
            <div>
              <h1 className="text-lg font-bold text-orange-400">Savage Chainsaws</h1>
              <p className="text-xs text-gray-400">Customer Portal</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium">{customer.name}</p>
            <p className="text-xs text-gray-500">{userEmail}</p>
          </div>
        </div>
      </header>

      {/* Professional Banner */}
      <div className="bg-zinc-900 border-b border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 py-8 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-2">
            Chainsaw Precision by Jesse
          </h2>
          <p className="text-orange-400 text-sm md:text-base">
            Fast diagnostics • Expert repairs • Fleet support
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-orange-400">{units.length}</p>
            <p className="text-xs text-gray-400 mt-1">Total Units</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-yellow-400">
              {units.filter(u => u.status === 'Needs Approval').length}
            </p>
            <p className="text-xs text-gray-400 mt-1">Needs Approval</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-blue-400">
              {units.filter(u => u.status === 'In Repair' || u.status === 'Waiting on Parts').length}
            </p>
            <p className="text-xs text-gray-400 mt-1">In Progress</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-green-400">
              {units.filter(u => u.status === 'Completed').length}
            </p>
            <p className="text-xs text-gray-400 mt-1">Completed</p>
          </div>
        </div>

        {/* Units List */}
        <section>
          <h2 className="text-xl font-bold mb-4 text-orange-400">Your Units</h2>

          {units.length === 0 ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center text-gray-400">
              No units found yet.
            </div>
          ) : (
            <div className="space-y-4">
              {units.map((unit) => (
                <div
                  key={unit.id}
                  className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 relative"
                >
                  {unit.status === 'Needs Approval' && (
                    <div className="absolute top-4 right-4 text-2xl" title="Action needed">
                      🚩
                    </div>
                  )}

                  <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                    <div>
                      <p className="font-bold text-lg">{unit.serial_number}</p>
                      <p className="text-sm text-gray-400">
                        {unit.model || 'Unknown model'} {unit.equipment_type ? `• ${unit.equipment_type}` : ''}
                      </p>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-medium ${
                        unit.status === 'Needs Approval'
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : unit.status === 'Completed'
                          ? 'bg-green-500/20 text-green-400'
                          : unit.status === 'In Repair' || unit.status === 'Waiting on Parts'
                          ? 'bg-blue-500/20 text-blue-400'
                          : 'bg-zinc-700 text-gray-300'
                      }`}
                    >
                      {unit.status}
                    </span>
                  </div>

                  {unit.problem_type && (
                    <p className="text-sm text-gray-300 mb-2">
                      <span className="text-gray-500">Problem:</span> {unit.problem_type}
                    </p>
                  )}

                  {unit.notes && (
                    <div className="bg-zinc-800/50 rounded-lg p-3 mb-3 text-sm text-gray-300">
                      {unit.notes}
                    </div>
                  )}

                  {unit.invoice_url && (
                    <a
                      href={unit.invoice_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block text-sm text-orange-400 hover:text-orange-300 mb-3"
                    >
                      View Invoice →
                    </a>
                  )}

                  {unit.status === 'Needs Approval' && (
                    <div className="mt-4 pt-4 border-t border-zinc-800">
                      <p className="text-sm text-yellow-400 mb-3 font-medium">
                        This unit needs your decision
                      </p>
                      <input
                        type="text"
                        placeholder="Type your full name to confirm"
                        value={decisionName}
                        onChange={(e) => setDecisionName(e.target.value)}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:border-orange-500"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleDecision(unit.id, 'approved')}
                          className="bg-green-600 hover:bg-green-500 text-white text-sm font-medium px-4 py-2 rounded-lg"
                        >
                          Approve Repair
                        </button>
                        <button
                          onClick={() => handleDecision(unit.id, 'upgrade')}
                          className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg"
                        >
                          Upgrade / Equivalent
                        </button>
                        <button
                          onClick={() => handleDecision(unit.id, 'denied')}
                          className="bg-red-600/80 hover:bg-red-500 text-white text-sm font-medium px-4 py-2 rounded-lg"
                        >
                          Deny (Diagnosis fee $49.99)
                        </button>
                      </div>
                    </div>
                  )}

                  {unit.decision && (
                    <div className="mt-3 text-xs text-gray-400">
                      Decision: <span className="text-white">{unit.decision}</span>
                      {unit.decision_by && <> by {unit.decision_by}</>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Footer */}
      <footer className="border-t border-zinc-800 pt-6 pb-10 text-center space-y-2 mt-12">
        <p className="text-sm text-gray-500">Savage Chainsaws LLC · Oviedo, Florida</p>
        <div className="flex flex-wrap justify-center gap-4 text-sm">
          <a
            href="https://savagechainsaws.com"
            target="_blank"
            rel="noreferrer"
            className="text-orange-400 hover:text-orange-300"
          >
            Website
          </a>
          <a
            href="mailto:savagechainsaws@gmail.com"
            className="text-orange-400 hover:text-orange-300"
          >
            Email us
          </a>
        </div>
        <p className="text-xs text-gray-600">Chainsaw Precision by Jesse</p>
      </footer>
    </main>
  )
}
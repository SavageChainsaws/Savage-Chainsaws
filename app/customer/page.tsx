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
  const [approverName, setApproverName] = useState('')
  const [newSerial, setNewSerial] = useState('')
  const [newModel, setNewModel] = useState('')
  const [newNotes, setNewNotes] = useState('')
  const [messageText, setMessageText] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) {
      router.replace('/customer/login')
      return
    }
    setUserEmail(user.email)

    const { data: cust } = await supabase
      .from('customers')
      .select('*')
      .eq('email', user.email)
      .maybeSingle()

    if (!cust) {
      setCustomer(null)
      setLoading(false)
      return
    }
    setCustomer(cust)

    const { data: unitList } = await supabase
      .from('units')
      .select('*')
      .eq('customer_id', cust.id)
      .order('created_at', { ascending: false })

    setUnits(unitList || [])
    setLoading(false)
  }

  async function logout() {
    await supabase.auth.signOut()
    router.replace('/customer/login')
  }

  async function requestRepair(id: string) {
    setBusy(true)
    const stamp = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    const { data: existing } = await supabase.from('units').select('history').eq('id', id).single()
    const line = `${stamp} — Customer requested repair`
    await supabase.from('units').update({
      status: 'Repair Requested',
      notes: 'Customer requested repair',
      history: existing?.history ? `${line}\n${existing.history}` : line,
    }).eq('id', id)
    await load()
    setBusy(false)
  }

  async function decide(id: string, decision: string) {
    if (!approverName.trim()) {
      alert('Enter your name first')
      return
    }
    setBusy(true)
    const stamp = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    let note = ''
    let status = 'In Repair'
    if (decision === 'approve') note = `Approved by ${approverName.trim()}`
    else if (decision === 'upgrade') note = `Upgrade requested by ${approverName.trim()}`
    else if (decision === 'equivalent') note = `Equivalent replacement requested by ${approverName.trim()}`
    else {
      note = `Denied by ${approverName.trim()} — diagnosis fee $49.99 may apply`
      status = 'Completed'
    }
    const { data: existing } = await supabase.from('units').select('history').eq('id', id).single()
    const line = `${stamp} — ${note}`
    await supabase.from('units').update({
      status,
      notes: note,
      decision_seen: false,
      history: existing?.history ? `${line}\n${existing.history}` : line,
    }).eq('id', id)
    setApproverName('')
    await load()
    setBusy(false)
  }

  async function addUnit(e: React.FormEvent) {
    e.preventDefault()
    if (!customer || !newSerial.trim()) return
    setBusy(true)
    await supabase.from('units').insert({
      serial_number: newSerial.trim(),
      model: newModel || null,
      customer_id: customer.id,
      status: 'Registered',
      notes: newNotes || 'Registered unit',
      decision_seen: true,
    })
    setNewSerial('')
    setNewModel('')
    setNewNotes('')
    await load()
    setBusy(false)
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!customer || !messageText.trim()) return
    setBusy(true)
    await supabase.from('messages').insert({
      message: messageText.trim(),
      customer_name: customer.name,
      customer_id: customer.id,
      is_read: false,
    })
    setMessageText('')
    setBusy(false)
    alert('Message sent')
  }

  function formatDate(dateString: string | null) {
    if (!dateString) return '—'
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-gray-400">Loading…</p>
      </main>
    )
  }

  if (!customer) {
    return (
      <main className="min-h-screen bg-black text-white p-6 flex items-center justify-center">
        <div className="max-w-md text-center space-y-4">
          <img src="/images/logo.png" alt="Savage Chainsaws" className="h-16 w-16 mx-auto object-contain" />
          <h1 className="text-2xl font-bold">
            SAVAGE <span className="text-orange-500">CHAINSAWS</span>
          </h1>
          <p className="text-gray-400">
            Your account ({userEmail}) is not linked to a customer profile yet.
            Contact Jesse and he’ll link your email.
          </p>
          <button onClick={logout} className="text-sm text-orange-400 hover:text-orange-300">
            Log out
          </button>
        </div>
      </main>
    )
  }

  const needsDecision = units.filter(u => u.status === 'Needs Approval')
  const inShop = units.filter(u =>
    ['Diagnosing', 'In Repair', 'Repair Requested', 'Ready for Pickup'].includes(u.status)
  )

  return (
    <main className="min-h-screen bg-black text-white">
      <header className="border-b border-zinc-800 bg-zinc-950/80">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="/images/logo.png" alt="Savage Chainsaws" className="h-10 w-10 object-contain" />
            <div>
              <p className="font-bold tracking-tight text-sm sm:text-base">
                SAVAGE <span className="text-orange-500">CHAINSAWS</span>
              </p>
              <p className="text-xs text-gray-500">Customer portal</p>
            </div>
          </div>
          <button onClick={logout} className="text-sm text-gray-400 hover:text-white">
            Log out
          </button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        <section className="space-y-3">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Signed in as</p>
            <h1 className="text-2xl font-semibold text-orange-400">{customer.name}</h1>
            <p className="text-sm text-gray-400">{userEmail}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <a
              href="https://savagechainsaws.com"
              target="_blank"
              rel="noreferrer"
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-orange-500/50 transition"
            >
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Website</p>
              <p className="text-sm text-orange-400 font-medium">savagechainsaws.com →</p>
            </a>
            <a
              href="mailto:savagechainsaws@gmail.com"
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-orange-500/50 transition"
            >
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Email</p>
              <p className="text-sm text-white font-medium">savagechainsaws@gmail.com</p>
            </a>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Service area</p>
              <p className="text-sm text-white font-medium">Oviedo, FL & surrounding</p>
            </div>
          </div>
        </section>

        {needsDecision.length > 0 && (
          <section className="bg-zinc-900 border border-yellow-500/40 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800">
              <h2 className="font-semibold text-yellow-400">
                Action needed ({needsDecision.length})
              </h2>
              <p className="text-xs text-gray-500 mt-1">Approve, upgrade, or decline the repair</p>
            </div>
            <div className="divide-y divide-zinc-800">
              {needsDecision.map(unit => (
                <div key={unit.id} className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-semibold">{unit.serial_number}</p>
                      <p className="text-sm text-gray-400">
                        {unit.model || '—'} · {unit.problem_type || unit.notes || 'Awaiting approval'}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">Checked in {formatDate(unit.created_at)}</p>
                    </div>
                    <span className="text-xs px-2.5 py-1 rounded-full bg-yellow-500/20 text-yellow-400 shrink-0">
                      Needs Approval
                    </span>
                  </div>
                  {unit.invoice_url && (
                    <a
                      href={unit.invoice_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block text-sm text-orange-400 hover:text-orange-300"
                    >
                      View estimate / invoice →
                    </a>
                  )}
                  <input
                    value={approverName}
                    onChange={e => setApproverName(e.target.value)}
                    placeholder="Your name (required)"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      disabled={busy}
                      onClick={() => decide(unit.id, 'approve')}
                      className="bg-green-600 hover:bg-green-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
                    >
                      Approve repair
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => decide(unit.id, 'upgrade')}
                      className="bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
                    >
                      Upgrade
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => decide(unit.id, 'equivalent')}
                      className="bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
                    >
                      Same / equivalent
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => decide(unit.id, 'deny')}
                      className="bg-red-700/80 hover:bg-red-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
                    >
                      Deny ($49.99 diagnosis)
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {inShop.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
              In the shop ({inShop.length})
            </h2>
            <div className="space-y-3">
              {inShop.map(unit => (
                <div
                  key={unit.id}
                  className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-start justify-between gap-3"
                >
                  <div>
                    <p className="font-semibold">{unit.serial_number}</p>
                    <p className="text-sm text-gray-400">
                      {unit.model || '—'}
                      {unit.equipment_type ? ` · ${unit.equipment_type}` : ''}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">Checked in {formatDate(unit.created_at)}</p>
                    {unit.notes && <p className="text-sm text-gray-300 mt-2">{unit.notes}</p>}
                  </div>
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full shrink-0 ${
                      unit.status === 'Ready for Pickup'
                        ? 'bg-green-500/20 text-green-400'
                        : unit.status === 'In Repair'
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'bg-orange-500/20 text-orange-400'
                    }`}
                  >
                    {unit.status}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="flex flex-wrap gap-3">
          <details className="bg-zinc-900 border border-zinc-800 rounded-xl open:border-orange-500/40">
            <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-orange-400 list-none">
              + Register a unit
            </summary>
            <form onSubmit={addUnit} className="px-4 pb-4 space-y-3 border-t border-zinc-800 pt-3">
              <input
                required
                value={newSerial}
                onChange={e => setNewSerial(e.target.value)}
                placeholder="Serial number *"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
              />
              <input
                value={newModel}
                onChange={e => setNewModel(e.target.value)}
                placeholder="Model"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
              />
              <textarea
                value={newNotes}
                onChange={e => setNewNotes(e.target.value)}
                rows={2}
                placeholder="Notes (optional)"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
              />
              <button
                type="submit"
                disabled={busy}
                className="bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
              >
                Save unit
              </button>
            </form>
          </details>

          <details className="bg-zinc-900 border border-zinc-800 rounded-xl open:border-orange-500/40">
            <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-300 list-none">
              Send a message
            </summary>
            <form onSubmit={sendMessage} className="px-4 pb-4 space-y-3 border-t border-zinc-800 pt-3">
              <textarea
                required
                value={messageText}
                onChange={e => setMessageText(e.target.value)}
                rows={3}
                placeholder="What do you need?"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
              />
              <button
                type="submit"
                disabled={busy}
                className="bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
              >
                Send
              </button>
            </form>
          </details>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Your units ({units.length})
          </h2>
          {units.length === 0 ? (
            <p className="text-sm text-gray-500">No units on file yet. Register one above or drop it off.</p>
          ) : (
            <div className="space-y-3">
              {units.map(unit => (
                <div key={unit.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-lg">{unit.serial_number}</p>
                      <p className="text-sm text-gray-400">
                        {unit.model || '—'}
                        {unit.equipment_type ? ` · ${unit.equipment_type}` : ''}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Status: <span className="text-orange-400">{unit.status}</span>
                        {' · '}
                        {formatDate(unit.created_at)}
                      </p>
                      {unit.notes && <p className="text-sm text-gray-300 mt-2">{unit.notes}</p>}
                    </div>
                    <span className="text-xs px-2.5 py-1 rounded-full bg-zinc-800 text-gray-300 shrink-0">
                      {unit.status}
                    </span>
                  </div>
                  {unit.status === 'Registered' && (
                    <button
                      disabled={busy}
                      onClick={() => requestRepair(unit.id)}
                      className="mt-3 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
                    >
                      Request Repair
                    </button>
                  )}
                  {unit.invoice_url && (
                    <a
                      href={unit.invoice_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block mt-2 text-sm text-orange-400 hover:text-orange-300"
                    >
                      View file →
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <footer className="border-t border-zinc-800 pt-6 pb-10 text-center space-y-2">
          <p className="text-sm text-gray-500">Savage Chainsaws LLC · Oviedo, Florida</p>
          <div className="flex flex-wrap justify-center gap-4 text-sm">
            <a href="https://savagechainsaws.com" target="_blank" rel="noreferrer" className="text-orange-400 hover:text-orange-300">
              Website
            </a>
            <a href="mailto:savagechainsaws@gmail.com" className="text-orange-400 hover:text-orange-300">
              Email us
            </a>
          </div>
          <p className="text-xs text-gray-600">Chainsaw Precision by Jesse</p>
        </footer>
      </div>
    </main>
  )
}
'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const EQUIPMENT_TYPES = [
  'Chainsaw',
  'Pole Saw',
  'Hedge Trimmer',
  'String Trimmer',
  'Edger',
  'Blower',
  'Backpack Blower',
  'Cutquik',
  'Riding Mower',
  'Other',
]

type Unit = {
  id: string
  serial_number: string
  model: string | null
  status: string
  notes: string | null
  problem_type: string | null
  equipment_type: string | null
  hour_meter: string | null
  invoice_url: string | null
  photo_url: string | null
  created_at: string
  check_in_date: string | null
  customer_id: string
  decision?: string | null
  decision_by?: string | null
}

type Customer = {
  id: string
  name: string
  email: string | null
}

export default function CustomerPortal() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [units, setUnits] = useState<Unit[]>([])
  const [decisionName, setDecisionName] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [serial, setSerial] = useState('')
  const [model, setModel] = useState('')
  const [equipmentType, setEquipmentType] = useState('Chainsaw')
  const [problemType, setProblemType] = useState('')
  const [hourMeter, setHourMeter] = useState('')
  const [notes, setNotes] = useState('')
  const [dropOffDate, setDropOffDate] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)

  async function refreshUnits(customerId: string) {
    const { data } = await supabase
      .from('units')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
    setUnits(data || [])
  }

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
      await refreshUnits(cust.id)
      setLoading(false)
    }
    load()
  }, [router])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

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
        status: decision === 'approved' ? 'In Repair' : 'Diagnosing',
      })
      .eq('id', unitId)
    if (customer) await refreshUnits(customer.id)
    setDecisionName('')
  }

  async function handleCheckIn(e: React.FormEvent) {
    e.preventDefault()
    if (!customer) return
    if (!serial.trim()) {
      alert('Serial number is required.')
      return
    }
    setSaving(true)
    let photoUrl: string | null = null
    if (photoFile) {
      const ext = photoFile.name.split('.').pop() || 'jpg'
      const path = `${customer.id}/${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from('unit-photos')
        .upload(path, photoFile)
      if (!uploadError) {
        const { data } = supabase.storage.from('unit-photos').getPublicUrl(path)
        photoUrl = data.publicUrl
      }
    }
    const insertData: Record<string, unknown> = {
      customer_id: customer.id,
      serial_number: serial.trim(),
      model: model.trim() || null,
      equipment_type: equipmentType,
      problem_type: problemType.trim() || null,
      notes: notes.trim() || null,
      status: 'Diagnosing',
      photo_url: photoUrl,
      check_in_date: dropOffDate || new Date().toISOString(),
    }
    if (equipmentType === 'Riding Mower' && hourMeter.trim()) {
      insertData.hour_meter = hourMeter.trim()
    }
    const { error } = await supabase.from('units').insert(insertData)
    setSaving(false)
    if (error) {
      alert('Could not check in this unit. Let Jesse know if this keeps happening.')
      console.error(error)
      return
    }
    setSerial('')
    setModel('')
    setEquipmentType('Chainsaw')
    setProblemType('')
    setHourMeter('')
    setNotes('')
    setDropOffDate('')
    setPhotoFile(null)
    setShowForm(false)
    await refreshUnits(customer.id)
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
      {/* HEADER WITH LOG OUT */}
      <header className="border-b border-zinc-800 bg-zinc-900 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/images/logo.png" alt="Savage Chainsaws" className="h-10 w-auto" />
            <div>
              <h1 className="text-lg font-bold text-orange-400">Savage Chainsaws</h1>
              <p className="text-xs text-gray-400">Customer Portal</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-white">{customer.name}</p>
              <p className="text-xs text-gray-500">{userEmail}</p>
            </div>
            <button
              onClick={handleLogout}
              className="text-sm bg-zinc-800 hover:bg-orange-600 text-white border border-zinc-600 hover:border-orange-500 px-4 py-2 rounded-lg transition"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      {/* BANNER */}
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
        {/* STATS */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-orange-400">{units.length}</p>
            <p className="text-xs text-gray-400 mt-1">Total Units</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-yellow-400">
              {units.filter((u) => u.status === 'Needs Approval').length}
            </p>
            <p className="text-xs text-gray-400 mt-1">Needs Approval</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-blue-400">
              {units.filter((u) => u.status === 'In Repair' || u.status === 'Waiting on Parts').length}
            </p>
            <p className="text-xs text-gray-400 mt-1">In Progress</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-green-400">
              {units.filter((u) => u.status === 'Completed').length}
            </p>
            <p className="text-xs text-gray-400 mt-1">Completed</p>
          </div>
        </div>

        {/* CHECK IN BUTTON */}
        <div className="flex justify-end">
          <button
            onClick={() => setShowForm((v) => !v)}
            className="bg-orange-500 hover:bg-orange-400 text-black font-semibold px-5 py-2 rounded-lg"
          >
            {showForm ? 'Close Check-In' : 'Check In a Unit'}
          </button>
        </div>

        {/* CHECK IN FORM */}
        {showForm && (
          <form
            onSubmit={handleCheckIn}
            className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4"
          >
            <h3 className="text-lg font-bold text-orange-400">Check In a Unit</h3>
            <p className="text-sm text-gray-400">
              Tell us what’s coming in. Jesse can correct any details after pickup.
            </p>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Serial Number *</label>
                <input
                  value={serial}
                  onChange={(e) => setSerial(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Model</label>
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. MS 462"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Unit Type</label>
                <select
                  value={equipmentType}
                  onChange={(e) => setEquipmentType(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                >
                  {EQUIPMENT_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">What’s wrong</label>
                <input
                  value={problemType}
                  onChange={(e) => setProblemType(e.target.value)}
                  placeholder="Won't start, loss of power, etc."
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              {equipmentType === 'Riding Mower' && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Hour Meter</label>
                  <input
                    value={hourMeter}
                    onChange={(e) => setHourMeter(e.target.value)}
                    placeholder="e.g. 142.5"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Scheduled drop-off (optional)</label>
                <input
                  type="datetime-local"
                  value={dropOffDate}
                  onChange={(e) => setDropOffDate(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Photo of unit / serial plate</label>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
                className="text-sm text-gray-300"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything else we should know..."
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm min-h-[80px]"
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-black font-semibold px-5 py-2 rounded-lg"
            >
              {saving ? 'Checking in...' : 'Check In Unit'}
            </button>
          </form>
        )}

        {/* UNITS LIST */}
        <section>
          <h2 className="text-xl font-bold mb-4 text-orange-400">Your Units</h2>
          {units.length === 0 ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center text-gray-400">
              No units found yet. Check one in above when you’re ready.
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
                        {unit.model || 'Unknown model'}
                        {unit.equipment_type ? ` • ${unit.equipment_type}` : ''}
                        {unit.hour_meter ? ` • ${unit.hour_meter} hrs` : ''}
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
                  {unit.photo_url && (
                    <img
                      src={unit.photo_url}
                      alt="Unit"
                      className="rounded-lg max-h-40 mb-3 border border-zinc-800"
                    />
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

            {/* FOOTER with sharpening photo on mobile */}
      <footer className="border-t border-zinc-800 pt-6 pb-10 text-center space-y-4 mt-12 relative overflow-hidden">
        {/* Sharpening / sparks image — bottom banner on mobile */}
        <div className="absolute inset-x-0 bottom-0 h-32 md:h-40 pointer-events-none opacity-40 md:opacity-30">
          <img
            src="/images/sparks.jpg"
            alt=""
            className="w-full h-full object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/80 to-transparent" />
        </div>

        <div className="relative z-10 space-y-2">
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
        </div>
      </footer>
    </main>
  )
}
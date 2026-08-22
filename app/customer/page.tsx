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
  thumbnail_url: string | null
  invoice_url: string | null
  created_at: string
  is_priority: boolean | null
  customer_id: string
  nickname: string | null
  archived: boolean | null
  hour_meter: string | null
}

type Customer = {
  id: string
  name: string
  email: string | null
}

const ACTIVE_STATUSES = [
  'Diagnosing',
  'Needs Approval',
  'In Repair',
  'Repair Requested',
  'Ready for Pickup',
]

export default function CustomerPortal() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [units, setUnits] = useState<Unit[]>([])
  const [showCheckIn, setShowCheckIn] = useState(false)
  const [showAddFleet, setShowAddFleet] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null)

  // Check-in form
  const [serial, setSerial] = useState('')
  const [model, setModel] = useState('')
  const [unitType, setUnitType] = useState('Chainsaw')
  const [problem, setProblem] = useState('')
  const [scheduled, setScheduled] = useState('')
  const [notes, setNotes] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)

  // Add to fleet form
  const [fleetSerial, setFleetSerial] = useState('')
  const [fleetModel, setFleetModel] = useState('')
  const [fleetType, setFleetType] = useState('Chainsaw')
  const [fleetNickname, setFleetNickname] = useState('')
  const [fleetThumb, setFleetThumb] = useState<File | null>(null)

  // Unit detail
  const [editNickname, setEditNickname] = useState('')
  const [thumbFile, setThumbFile] = useState<File | null>(null)
  const [thumbPreview, setThumbPreview] = useState<string | null>(null)
  const [serviceNote, setServiceNote] = useState('')
  const [detailBusy, setDetailBusy] = useState(false)

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
      .or('archived.is.null,archived.eq.false')
      .order('created_at', { ascending: false })

    setUnits(unitData || [])
    setLoading(false)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  async function uploadFile(file: File, prefix: string) {
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const fileName = `${prefix}-${Date.now()}-${safe}`
    const { error } = await supabase.storage
      .from('invoices')
      .upload(fileName, file, {
        contentType: file.type || 'image/jpeg',
        upsert: false,
      })
    if (error) throw error
    const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(fileName)
    return publicUrl
  }

  async function handleCheckIn(e: React.FormEvent) {
    e.preventDefault()
    if (!customer || !serial.trim()) return
    setSubmitting(true)
    setMessage(null)
    try {
      let photoUrl: string | null = null
      if (photoFile) photoUrl = await uploadFile(photoFile, customer.id)

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
        thumbnail_url: photoUrl,
        customer_id: customer.id,
        status: 'Repair Requested',
        decision_seen: true,
        archived: false,
        created_at: createdAt,
      })

      if (error) {
        console.error(error)
        setMessage('Could not check in this unit. Let Jesse know if this keeps happening.')
        setSubmitting(false)
        return
      }

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

  async function handleAddFleet(e: React.FormEvent) {
    e.preventDefault()
    if (!customer || !fleetSerial.trim()) return
    setSubmitting(true)
    setMessage(null)
    try {
      let thumbUrl: string | null = null
      if (fleetThumb) thumbUrl = await uploadFile(fleetThumb, `fleet-${customer.id}`)

      const { error } = await supabase.from('units').insert({
        serial_number: fleetSerial.trim(),
        model: fleetModel.trim() || null,
        equipment_type: fleetType || null,
        nickname: fleetNickname.trim() || null,
        thumbnail_url: thumbUrl,
        customer_id: customer.id,
        status: 'Fleet',
        decision_seen: true,
        archived: false,
        history: `${new Date().toLocaleString('en-US', {
          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        })} — Added to fleet by customer`,
      })

      if (error) {
        console.error(error)
        setMessage('Could not add unit to fleet.')
        setSubmitting(false)
        return
      }

      setFleetSerial('')
      setFleetModel('')
      setFleetType('Chainsaw')
      setFleetNickname('')
      setFleetThumb(null)
      setShowAddFleet(false)
      setMessage('Unit added to your fleet.')
      await loadData()
    } catch (err) {
      console.error(err)
      setMessage('Could not add unit to fleet.')
    }
    setSubmitting(false)
  }

  function openUnit(unit: Unit) {
    setSelectedUnit(unit)
    setEditNickname(unit.nickname || '')
    setThumbFile(null)
    setThumbPreview(null)
    setServiceNote('')
    setMessage(null)
    setShowCheckIn(false)
    setShowAddFleet(false)
  }

  function closeUnit() {
    setSelectedUnit(null)
    setThumbFile(null)
    setThumbPreview(null)
    setServiceNote('')
  }

  function onThumbPick(file: File | null) {
    setThumbFile(file)
    if (thumbPreview) URL.revokeObjectURL(thumbPreview)
    setThumbPreview(file ? URL.createObjectURL(file) : null)
  }

  async function saveNickname() {
    if (!selectedUnit) return
    setDetailBusy(true)
    const { error } = await supabase
      .from('units')
      .update({ nickname: editNickname.trim() || null })
      .eq('id', selectedUnit.id)
    setDetailBusy(false)
    if (error) {
      setMessage('Could not save nickname.')
      return
    }
    setMessage('Nickname saved.')
    await loadData()
    setSelectedUnit(prev => prev ? { ...prev, nickname: editNickname.trim() || null } : null)
  }

  async function saveThumbnail() {
    if (!selectedUnit || !thumbFile) return
    setDetailBusy(true)
    try {
      const url = await uploadFile(thumbFile, `thumb-${selectedUnit.id}`)
      const { error } = await supabase
        .from('units')
        .update({ thumbnail_url: url })
        .eq('id', selectedUnit.id)
      if (error) throw error
      setMessage('Thumbnail updated.')
      onThumbPick(null)
      await loadData()
      setSelectedUnit(prev => prev ? { ...prev, thumbnail_url: url } : null)
    } catch (err) {
      console.error(err)
      setMessage('Could not upload thumbnail.')
    }
    setDetailBusy(false)
  }

  async function requestService() {
    if (!selectedUnit || !customer) return
    setDetailBusy(true)

    const name = customer.name || userEmail || 'Customer'
    const note = serviceNote.trim() || 'Customer requested tune-up / service'
    const historyLine = `${new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })} — Service requested by ${name}: ${note}`

    const { data: existing } = await supabase
      .from('units')
      .select('notes, history')
      .eq('id', selectedUnit.id)
      .single()

    const { error } = await supabase
      .from('units')
      .update({
        status: 'Repair Requested',
        problem_type: note,
        notes: existing?.notes ? `${note}\n${existing.notes}` : note,
        decision_seen: true,
        history: existing?.history ? `${historyLine}\n${existing.history}` : historyLine,
      })
      .eq('id', selectedUnit.id)

    setDetailBusy(false)
    if (error) {
      console.error(error)
      setMessage('Could not request service.')
      return
    }
    setMessage('Service requested. Jesse has been notified.')
    await loadData()
    closeUnit()
  }

  async function archiveUnit() {
    if (!selectedUnit || !customer) return
    if (!confirm('Remove this unit from your list? Jesse will still keep a history of it.')) return

    setDetailBusy(true)
    const name = customer.name || userEmail || 'Customer'
    const historyLine = `${new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })} — Archived by ${name} (removed from customer list)`

    const { data: existing } = await supabase
      .from('units')
      .select('history')
      .eq('id', selectedUnit.id)
      .single()

    const { error } = await supabase
      .from('units')
      .update({
        archived: true,
        history: existing?.history ? `${historyLine}\n${existing.history}` : historyLine,
      })
      .eq('id', selectedUnit.id)

    setDetailBusy(false)
    if (error) {
      console.error(error)
      setMessage('Could not remove unit.')
      return
    }
    setMessage('Unit removed from your list.')
    closeUnit()
    await loadData()
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
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })} — ${note}`

    const { error } = await supabase
      .from('units')
      .update({
        status,
        notes: existing?.notes ? `${note}\n${existing.notes}` : note,
        decision_seen: false,
        history: existing?.history ? `${historyLine}\n${existing.history}` : historyLine,
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
    if (selectedUnit?.id === unitId) closeUnit()
  }

  const activeUnits = units.filter(u => ACTIVE_STATUSES.includes(u.status))
  const fleetUnits = units.filter(u => u.status === 'Fleet')
  const otherUnits = units.filter(
    u => !ACTIVE_STATUSES.includes(u.status) && u.status !== 'Fleet'
  )

  const total = units.length
  const needsApproval = units.filter(u => u.status === 'Needs Approval').length
  const inProgress = units.filter(u =>
    ['Diagnosing', 'In Repair', 'Repair Requested'].includes(u.status)
  ).length
  const completed = units.filter(u =>
    ['Completed', 'Ready for Pickup'].includes(u.status)
  ).length

  function displayName(u: Unit) {
    return u.nickname || u.serial_number
  }

  function unitImage(u: Unit) {
    return u.thumbnail_url || u.photo_url
  }

  function UnitCard({ unit }: { unit: Unit }) {
    return (
      <button
        type="button"
        onClick={() => openUnit(unit)}
        className="w-full text-left bg-zinc-900 border border-zinc-800 hover:border-orange-500/50 rounded-xl p-4 flex gap-4 transition"
      >
        <div className="shrink-0">
          {unitImage(unit) ? (
            <img
              src={unitImage(unit)!}
              alt=""
              className="h-14 w-14 sm:h-16 sm:w-16 object-cover rounded-lg border border-zinc-700"
            />
          ) : (
            <div className="h-14 w-14 sm:h-16 sm:w-16 rounded-lg border border-zinc-700 bg-zinc-800" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-0.5">
            <p className="font-semibold text-base sm:text-lg truncate">{displayName(unit)}</p>
            {unit.nickname && (
              <span className="text-xs text-gray-500 truncate">S/N {unit.serial_number}</span>
            )}
            <span
              className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                unit.status === 'Needs Approval'
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : unit.status === 'Fleet'
                  ? 'bg-zinc-600 text-gray-300'
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
          {unit.problem_type && unit.status !== 'Fleet' && (
            <p className="text-sm text-gray-500 mt-0.5">Problem: {unit.problem_type}</p>
          )}
          {unit.status === 'Needs Approval' && (
            <p className="text-xs text-yellow-400 mt-1">Tap to approve or decide →</p>
          )}
          {(unit.status === 'Fleet' || unit.status === 'Completed') && (
            <p className="text-xs text-gray-500 mt-1">Tap to schedule service or edit →</p>
          )}
        </div>
      </button>
    )
  }

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

        <div className="flex flex-wrap justify-end gap-2">
          <button
            onClick={() => {
              setShowAddFleet(!showAddFleet)
              setShowCheckIn(false)
              closeUnit()
            }}
            className="border border-zinc-600 hover:border-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            {showAddFleet ? 'Close' : 'Add to Fleet'}
          </button>
          <button
            onClick={() => {
              setShowCheckIn(!showCheckIn)
              setShowAddFleet(false)
              closeUnit()
            }}
            className="bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            {showCheckIn ? 'Close Check-In' : 'Check In a Unit'}
          </button>
        </div>

        {/* Add to Fleet */}
        {showAddFleet && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-orange-400 mb-1">Add Unit to Fleet</h2>
            <p className="text-sm text-gray-500 mb-4">
              Register equipment you own so you can schedule service later.
            </p>
            <form onSubmit={handleAddFleet} className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Serial Number *</label>
                <input
                  required
                  value={fleetSerial}
                  onChange={e => setFleetSerial(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Model</label>
                <input
                  value={fleetModel}
                  onChange={e => setFleetModel(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  placeholder="e.g. MS 462"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Unit Type</label>
                <select
                  value={fleetType}
                  onChange={e => setFleetType(e.target.value)}
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
                <label className="block text-xs text-gray-500 mb-1">Nickname (optional)</label>
                <input
                  value={fleetNickname}
                  onChange={e => setFleetNickname(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  placeholder="e.g. Shop mower #2"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Thumbnail photo (optional)</label>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={e => setFleetThumb(e.target.files?.[0] || null)}
                  className="w-full text-sm text-gray-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-orange-600 file:text-white"
                />
              </div>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-orange-600 hover:bg-orange-500 disabled:opacity-60 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition"
                >
                  {submitting ? 'Adding...' : 'Add to Fleet'}
                </button>
              </div>
            </form>
          </div>
        )}

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
                  placeholder="Won't start, tune-up, etc."
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
                  capture="environment"
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

        {/* Unit detail panel */}
        {selectedUnit && (
          <div className="bg-zinc-900 border border-orange-500/40 rounded-xl p-4 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex gap-3 min-w-0">
                {unitImage(selectedUnit) ? (
                  <img
                    src={unitImage(selectedUnit)!}
                    alt=""
                    className="h-16 w-16 object-cover rounded-lg border border-zinc-700 shrink-0"
                  />
                ) : (
                  <div className="h-16 w-16 rounded-lg border border-zinc-700 bg-zinc-800 shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="font-semibold text-lg truncate">{displayName(selectedUnit)}</p>
                  <p className="text-sm text-gray-400">
                    S/N: {selectedUnit.serial_number}
                    {selectedUnit.model ? ` · ${selectedUnit.model}` : ''}
                  </p>
                  <span className={`inline-block mt-1 text-xs px-2.5 py-1 rounded-full font-medium ${
                    selectedUnit.status === 'Needs Approval' ? 'bg-yellow-500/20 text-yellow-400'
                      : selectedUnit.status === 'Fleet' ? 'bg-zinc-600 text-gray-300'
                      : selectedUnit.status === 'Completed' || selectedUnit.status === 'Ready for Pickup' ? 'bg-green-500/20 text-green-400'
                      : 'bg-orange-500/20 text-orange-400'
                  }`}>{selectedUnit.status}</span>
                </div>
              </div>
              <button
                onClick={closeUnit}
                className="text-gray-400 hover:text-white text-sm border border-zinc-700 rounded-lg px-3 py-1.5 shrink-0"
              >
                Close
              </button>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Nickname (your label)</label>
              <div className="flex gap-2">
                <input
                  value={editNickname}
                  onChange={e => setEditNickname(e.target.value)}
                  placeholder="e.g. Shop mower #2"
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                />
                <button
                  onClick={saveNickname}
                  disabled={detailBusy}
                  className="bg-zinc-700 hover:bg-zinc-600 text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Unit thumbnail photo</label>
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                {(thumbPreview || selectedUnit.thumbnail_url) && (
                  <img
                    src={thumbPreview || selectedUnit.thumbnail_url!}
                    alt=""
                    className="h-20 w-20 object-cover rounded-lg border border-zinc-700"
                  />
                )}
                <div className="flex flex-col gap-2">
                  <label className="inline-flex items-center justify-center bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg cursor-pointer">
                    Choose Photo
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={e => onThumbPick(e.target.files?.[0] || null)}
                    />
                  </label>
                  {thumbFile && (
                    <button
                      onClick={saveThumbnail}
                      disabled={detailBusy}
                      className="bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg"
                    >
                      {detailBusy ? 'Uploading...' : 'Save Thumbnail'}
                    </button>
                  )}
                  {thumbFile && (
                    <p className="text-xs text-gray-400 truncate max-w-[200px]">{thumbFile.name}</p>
                  )}
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                This is the photo on your unit list (separate from service check-in photos).
              </p>
            </div>

            {(selectedUnit.status === 'Fleet' ||
              selectedUnit.status === 'Completed' ||
              selectedUnit.status === 'Registered') && (
              <div className="border-t border-zinc-800 pt-4">
                <label className="block text-xs text-gray-500 mb-1">Request service / tune-up</label>
                <input
                  value={serviceNote}
                  onChange={e => setServiceNote(e.target.value)}
                  placeholder="e.g. Due for 3-month tune-up..."
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm mb-2"
                />
                <button
                  onClick={requestService}
                  disabled={detailBusy}
                  className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
                >
                  Schedule Service
                </button>
              </div>
            )}

            {selectedUnit.status === 'Needs Approval' && (
              <div className="border-t border-zinc-800 pt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => handleDecision(selectedUnit.id, 'approve')}
                  className="bg-green-600 hover:bg-green-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
                >
                  Approve Repair
                </button>
                <button
                  onClick={() => handleDecision(selectedUnit.id, 'upgrade')}
                  className="bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
                >
                  Upgrade
                </button>
                <button
                  onClick={() => handleDecision(selectedUnit.id, 'equivalent')}
                  className="bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
                >
                  Same / Equivalent
                </button>
                <button
                  onClick={() => {
                    if (confirm('Deny this repair? A $49.99 diagnosis fee will be charged.')) {
                      handleDecision(selectedUnit.id, 'deny')
                    }
                  }}
                  className="bg-red-700 hover:bg-red-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
                >
                  Deny ($49.99 diag)
                </button>
              </div>
            )}

            <div className="border-t border-zinc-800 pt-4">
              <button
                onClick={archiveUnit}
                disabled={detailBusy}
                className="text-sm text-red-400 hover:text-red-300 disabled:opacity-50"
              >
                Remove from my list
              </button>
              <p className="text-xs text-gray-500 mt-1">
                Removes it from your view only. Jesse keeps a service history.
              </p>
            </div>
          </div>
        )}

        {/* Active service units — always open */}
        <div>
          <h2 className="text-lg font-semibold text-orange-400 mb-3">
            In Service ({activeUnits.length})
          </h2>
          {activeUnits.length === 0 ? (
            <p className="text-gray-500 text-sm">No units currently in service.</p>
          ) : (
            <div className="space-y-3">
              {activeUnits.map(unit => (
                <UnitCard key={unit.id} unit={unit} />
              ))}
            </div>
          )}
        </div>

        {/* Fleet — collapsible */}
        <details className="group" open={fleetUnits.length > 0 && fleetUnits.length <= 6}>
          <summary className="cursor-pointer list-none flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 hover:border-orange-500/40 transition">
            <h2 className="text-lg font-semibold text-orange-300">
              Fleet ({fleetUnits.length})
            </h2>
            <span className="text-gray-500 text-sm group-open:rotate-180 transition">▼</span>
          </summary>
          <div className="mt-3 space-y-3">
            {fleetUnits.length === 0 ? (
              <p className="text-gray-500 text-sm px-1">
                No fleet units yet. Use <strong>Add to Fleet</strong> to register equipment.
              </p>
            ) : (
              fleetUnits.map(unit => <UnitCard key={unit.id} unit={unit} />)
            )}
          </div>
        </details>

        {/* Other / completed — collapsible */}
        <details className="group">
          <summary className="cursor-pointer list-none flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 hover:border-orange-500/40 transition">
            <h2 className="text-lg font-semibold text-gray-300">
              Other Units ({otherUnits.length})
            </h2>
            <span className="text-gray-500 text-sm group-open:rotate-180 transition">▼</span>
          </summary>
          <div className="mt-3 space-y-3">
            {otherUnits.length === 0 ? (
              <p className="text-gray-500 text-sm px-1">No completed or other units.</p>
            ) : (
              otherUnits.map(unit => <UnitCard key={unit.id} unit={unit} />)
            )}
          </div>
        </details>
      </div>
    </main>
  )
}
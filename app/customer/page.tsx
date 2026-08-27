'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import AppNav from '../components/AppNav'
import { UnitPhoto } from '../components/UnitPhoto'

const supabase = createClient()

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
  warranty_end: string | null
  last_service_date: string | null
}

function isUnderWarranty(unit: { warranty_end: string | null }): boolean {
  if (!unit.warranty_end) return false
  const today = new Date().toISOString().slice(0, 10)
  return unit.warranty_end >= today
}

// Mirrors the admin dashboard's last_service_date convention (stamped
// whenever a unit's status moves to Completed/Ready for Pickup). A unit
// currently checked in doesn't need a reminder - it's already being
// serviced - and one with no service history yet has nothing to measure
// from, so neither case shows the indicator.
function needsMaintenanceReminder(unit: { status: string; last_service_date: string | null }): boolean {
  if (ACTIVE_STATUSES.includes(unit.status)) return false
  if (!unit.last_service_date) return false
  const fourMonthsAgo = new Date()
  fourMonthsAgo.setMonth(fourMonthsAgo.getMonth() - 4)
  return new Date(unit.last_service_date) < fourMonthsAgo
}

function monthsSince(dateString: string): number {
  const then = new Date(dateString)
  const now = new Date()
  return (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth())
}

type Customer = {
  id: string
  name: string
  email: string | null
  logo_url: string | null
}

const ACTIVE_STATUSES = [
  'Diagnosing',
  'Needs Approval',
  'In Repair',
  'Repair Requested',
  'Ready for Pickup',
]

const STIHL_PREFIX_MAP: Record<string, string> = {
  FC: 'Edger',
  FS: 'String Trimmer',
  MS: 'Chainsaw',
  HL: 'Hedge Trimmer',
  HT: 'Pole Saw',
  TS: 'Cut Quik Saw',
  KM: 'Kombi Unit',
  HS: 'Handheld Hedge Trimmer',
  BR: 'Backpack Blower',
  BG: 'Handheld Blower',
  RB: 'Pressure Washer',
  RZ: 'Riding Lawn Mower',
  SR: 'Backpack Sprayer',
}

const EQUIPMENT_CATEGORIES = [
  'Chainsaw',
  'Pole Saw',
  'String Trimmer',
  'Hedge Trimmer',
  'Handheld Hedge Trimmer',
  'Edger',
  'Cut Quik Saw',
  'Kombi Unit',
  'Backpack Blower',
  'Handheld Blower',
  'Pressure Washer',
  'Riding Lawn Mower',
  'Backpack Sprayer',
  'Other',
]

export default function CustomerPortal() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [units, setUnits] = useState<Unit[]>([])
  const [showCheckIn, setShowCheckIn] = useState(false)
  const [showAddFleet, setShowAddFleet] = useState(false)
  const [showLogoUpload, setShowLogoUpload] = useState(false)
  const [showMyFleet, setShowMyFleet] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null)

  const [serial, setSerial] = useState('')
  const [model, setModel] = useState('')
  const [unitType, setUnitType] = useState('')
  const [customUnitType, setCustomUnitType] = useState('')
  const [unitTypeManuallySet, setUnitTypeManuallySet] = useState(false)
  const [problem, setProblem] = useState('')
  const [scheduled, setScheduled] = useState('')
  const [notes, setNotes] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)

  const [fleetSerial, setFleetSerial] = useState('')
  const [fleetModel, setFleetModel] = useState('')
  const [fleetType, setFleetType] = useState('')
  const [fleetCustomType, setFleetCustomType] = useState('')
  const [fleetTypeManuallySet, setFleetTypeManuallySet] = useState(false)
  const [fleetNickname, setFleetNickname] = useState('')
  const [fleetHours, setFleetHours] = useState('')
  const [fleetThumb, setFleetThumb] = useState<File | null>(null)

  const [editNickname, setEditNickname] = useState('')
  const [editSerial, setEditSerial] = useState('')
  const [editModel, setEditModel] = useState('')
  const [editType, setEditType] = useState('')
  const [editCustomType, setEditCustomType] = useState('')
  const [editTypeManuallySet, setEditTypeManuallySet] = useState(false)
  const [editHours, setEditHours] = useState('')
  const [thumbFile, setThumbFile] = useState<File | null>(null)
  const [thumbPreview, setThumbPreview] = useState<string | null>(null)
  const [serviceNote, setServiceNote] = useState('')
  const [detailBusy, setDetailBusy] = useState(false)

  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [logoBusy, setLogoBusy] = useState(false)

  function handleModelChange(value: string) {
    const upper = value.toUpperCase()
    setModel(upper)
    if (unitTypeManuallySet) return
    const prefix = upper.trim().slice(0, 2)
    setUnitType(STIHL_PREFIX_MAP[prefix] || (upper.trim() ? 'Other' : ''))
  }

  function handleUnitTypeChange(value: string) {
    setUnitTypeManuallySet(true)
    setUnitType(value)
  }

  function handleFleetModelChange(value: string) {
    const upper = value.toUpperCase()
    setFleetModel(upper)
    if (fleetTypeManuallySet) return
    const prefix = upper.trim().slice(0, 2)
    setFleetType(STIHL_PREFIX_MAP[prefix] || (upper.trim() ? 'Other' : ''))
  }

  function handleFleetTypeChange(value: string) {
    setFleetTypeManuallySet(true)
    setFleetType(value)
  }

  function handleEditModelChange(value: string) {
    const upper = value.toUpperCase()
    setEditModel(upper)
    if (editTypeManuallySet) return
    const prefix = upper.trim().slice(0, 2)
    setEditType(STIHL_PREFIX_MAP[prefix] || (upper.trim() ? 'Other' : ''))
  }

  function handleEditTypeChange(value: string) {
    setEditTypeManuallySet(true)
    setEditType(value)
  }

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    setMessage(null)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/customer/login')
      return
    }
    setUserEmail(user.email ?? null)

    // Links this auth user to a matching, not-yet-linked customers row (by
    // verified email) so RLS on units - which checks auth_user_id, not
    // email - can see their existing records. No-ops if already linked or
    // no match exists.
    await supabase.rpc('link_customer_account')

    const { data: cust } = await supabase
      .from('customers')
      .select('id, name, email, logo_url')
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

  function onLogoPick(file: File | null) {
    setLogoFile(file)
    if (logoPreview) URL.revokeObjectURL(logoPreview)
    setLogoPreview(file ? URL.createObjectURL(file) : null)
  }

  async function saveLogo() {
    if (!customer || !logoFile) return
    setLogoBusy(true)
    setMessage(null)
    try {
      const url = await uploadFile(logoFile, `logo-${customer.id}`)
      const { error } = await supabase
        .from('customers')
        .update({ logo_url: url })
        .eq('id', customer.id)
      if (error) throw error
      setCustomer(prev => prev ? { ...prev, logo_url: url } : null)
      onLogoPick(null)
      setShowLogoUpload(false)
      setMessage('Company logo updated.')
    } catch (err) {
      console.error(err)
      setMessage('Could not upload logo. Try a smaller image (JPG/PNG).')
    }
    setLogoBusy(false)
  }

  async function removeLogo() {
    if (!customer) return
    if (!confirm('Remove your company logo?')) return
    setLogoBusy(true)
    const { error } = await supabase
      .from('customers')
      .update({ logo_url: null })
      .eq('id', customer.id)
    setLogoBusy(false)
    if (error) {
      setMessage('Could not remove logo.')
      return
    }
    setCustomer(prev => prev ? { ...prev, logo_url: null } : null)
    setMessage('Company logo removed.')
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
      const finalUnitType = unitType === 'Other' && customUnitType.trim() ? customUnitType.trim() : unitType
      const { error } = await supabase.from('units').insert({
        serial_number: serial.trim(),
        model: model.trim() || null,
        equipment_type: finalUnitType || null,
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
      setUnitType('')
      setCustomUnitType('')
      setUnitTypeManuallySet(false)
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
      const finalFleetType = fleetType === 'Other' && fleetCustomType.trim() ? fleetCustomType.trim() : fleetType
      const { error } = await supabase.from('units').insert({
        serial_number: fleetSerial.trim(),
        model: fleetModel.trim() || null,
        equipment_type: finalFleetType || null,
        nickname: fleetNickname.trim() || null,
        hour_meter: fleetType === 'Riding Lawn Mower' ? (fleetHours.trim() || null) : null,
        thumbnail_url: thumbUrl,
        customer_id: customer.id,
        status: 'Fleet',
        decision_seen: true,
        archived: false,
        history: `${new Date().toLocaleString('en-US', {
          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        })} - Added to fleet by customer`,
      })
      if (error) {
        console.error(error)
        setMessage('Could not add unit to fleet.')
        setSubmitting(false)
        return
      }
      setFleetSerial('')
      setFleetModel('')
      setFleetType('')
      setFleetCustomType('')
      setFleetTypeManuallySet(false)
      setFleetNickname('')
      setFleetHours('')
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
    setEditSerial(unit.serial_number || '')
    setEditModel(unit.model || '')
    setEditType(unit.equipment_type || '')
    setEditCustomType('')
    setEditTypeManuallySet(false)
    setEditHours(unit.hour_meter || '')
    setThumbFile(null)
    if (thumbPreview) URL.revokeObjectURL(thumbPreview)
    setThumbPreview(null)
    setServiceNote('')
    setMessage(null)
    setShowCheckIn(false)
    setShowAddFleet(false)
    setShowLogoUpload(false)
    setShowMyFleet(false)
  }

  function closeUnit() {
    setSelectedUnit(null)
    setThumbFile(null)
    if (thumbPreview) URL.revokeObjectURL(thumbPreview)
    setThumbPreview(null)
    setServiceNote('')
  }

  function onThumbPick(file: File | null) {
    setThumbFile(file)
    if (thumbPreview) URL.revokeObjectURL(thumbPreview)
    setThumbPreview(file ? URL.createObjectURL(file) : null)
  }

  async function saveUnitDetails() {
    if (!selectedUnit || !editSerial.trim()) {
      setMessage('Serial number is required.')
      return
    }
    setDetailBusy(true)
    const finalEditType = editType === 'Other' && editCustomType.trim() ? editCustomType.trim() : editType
    const finalEditHours = editType === 'Riding Lawn Mower' ? (editHours.trim() || null) : null
    const { error } = await supabase
      .from('units')
      .update({
        nickname: editNickname.trim() || null,
        serial_number: editSerial.trim(),
        model: editModel.trim() || null,
        equipment_type: finalEditType || null,
        hour_meter: finalEditHours,
      })
      .eq('id', selectedUnit.id)
    setDetailBusy(false)
    if (error) {
      console.error(error)
      setMessage('Could not save changes.')
      return
    }
    setMessage('Unit details saved.')
    await loadData()
    setSelectedUnit(prev =>
      prev
        ? {
            ...prev,
            nickname: editNickname.trim() || null,
            serial_number: editSerial.trim(),
            model: editModel.trim() || null,
            equipment_type: finalEditType || null,
            hour_meter: finalEditHours,
          }
        : null
    )
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
    })} - Service requested by ${name}: ${note}`
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

  async function withdrawService() {
    if (!selectedUnit || !customer) return
    if (!confirm('Withdraw this service request? The unit will go back to your fleet list.')) return
    setDetailBusy(true)
    const name = customer.name || userEmail || 'Customer'
    const historyLine = `${new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })} - Service withdrawn by ${name} - returned to fleet`
    const { data: existing } = await supabase
      .from('units')
      .select('history')
      .eq('id', selectedUnit.id)
      .single()
    const { error } = await supabase
      .from('units')
      .update({
        status: 'Fleet',
        problem_type: null,
        decision_seen: true,
        history: existing?.history ? `${historyLine}\n${existing.history}` : historyLine,
      })
      .eq('id', selectedUnit.id)
    setDetailBusy(false)
    if (error) {
      console.error(error)
      setMessage('Could not withdraw service request.')
      return
    }
    setMessage('Service request withdrawn. Unit is back on your fleet list.')
    closeUnit()
    await loadData()
  }

  async function archiveUnit() {
    if (!selectedUnit || !customer) return
    if (!confirm('Remove this unit from your list? Jesse will still keep a history of it.')) return
    setDetailBusy(true)
    const name = customer.name || userEmail || 'Customer'
    const historyLine = `${new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })} - Archived by ${name} (removed from customer list)`
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
      note = `Denied by ${name} - diagnosis fee $49.99 will apply`
    }
    const { data: existing } = await supabase
      .from('units')
      .select('notes, history')
      .eq('id', unitId)
      .single()
    const historyLine = `${new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })} - ${note}`
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
    const model = (u.model || '').trim()
    const type = (u.equipment_type || '').trim()
    if (model && type) return `${model} - ${type}`
    if (model) return model
    if (type) return type
    return u.nickname || u.serial_number || 'No model'
  }

  function UnitCard({ unit }: { unit: Unit }) {
    return (
      <button
        type="button"
        onClick={() => openUnit(unit)}
        className="w-full text-left bg-zinc-900 border border-zinc-800 hover:border-orange-500/50 rounded-xl p-4 flex gap-4 transition"
      >
        <UnitPhoto unit={unit} size="h-14 w-14 sm:h-16 sm:w-16" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-0.5">
            <p className="font-semibold text-base sm:text-lg truncate">{displayName(unit)}</p>
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
            </span>
            {isUnderWarranty(unit) && (
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-blue-500/20 text-blue-400">
                Under Warranty
              </span>
            )}
          </div>
          <p className="text-sm text-gray-400">
            Serial: {unit.serial_number || '-'}
            {unit.nickname ? ` - ${unit.nickname}` : ''}
            {unit.hour_meter ? ` - ${unit.hour_meter} hrs` : ''}
          </p>
          {unit.problem_type && unit.status !== 'Fleet' && (
            <p className="text-sm text-gray-500 mt-0.5">Problem: {unit.problem_type}</p>
          )}
          {unit.status === 'Needs Approval' && (
            <p className="text-xs text-yellow-400 mt-1">Tap to approve or decide {'->'}</p>
          )}
          {(unit.status === 'Fleet' || unit.status === 'Completed') && (
            <p className="text-xs text-gray-500 mt-1">Tap to edit or schedule service {'->'}</p>
          )}
          {(unit.status === 'Repair Requested' || unit.status === 'Diagnosing') && (
            <p className="text-xs text-gray-500 mt-1">Tap to view or withdraw service {'->'}</p>
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

  const canEditDetails =
    selectedUnit &&
    (selectedUnit.status === 'Fleet' ||
      selectedUnit.status === 'Completed' ||
      selectedUnit.status === 'Registered')

  const headerLogo = customer.logo_url || '/images/logo.png'

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-zinc-800 px-4 sm:px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img
              src={headerLogo}
              alt={customer.name}
              className="h-10 w-10 object-contain rounded-lg bg-zinc-900 border border-zinc-700"
            />
            <div>
              <p className="font-bold text-lg leading-tight">{customer.name}</p>
              <p className="text-xs text-gray-500">
                Powered by <span className="text-orange-400">Savage Chainsaws</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="text-right hidden sm:block">
              <p className="font-medium">{userEmail}</p>
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
              setShowLogoUpload(!showLogoUpload)
              setShowAddFleet(false)
              setShowCheckIn(false)
              setShowMyFleet(false)
              closeUnit()
            }}
            className="border border-zinc-600 hover:border-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            {showLogoUpload ? 'Close' : 'Company Logo'}
          </button>
          <button
            onClick={() => {
              setShowMyFleet(!showMyFleet)
              setShowAddFleet(false)
              setShowCheckIn(false)
              setShowLogoUpload(false)
              closeUnit()
            }}
            className="border border-zinc-600 hover:border-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            {showMyFleet ? 'Close' : 'My Fleet'}
          </button>
          <button
            onClick={() => {
              setShowAddFleet(!showAddFleet)
              setShowCheckIn(false)
              setShowLogoUpload(false)
              setShowMyFleet(false)
              closeUnit()
            }}
            className="border border-zinc-600 hover:border-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            {showAddFleet ? 'Close' : 'Add to Fleet'}
          </button>
          <AppNav />
          <button
            onClick={() => {
              setShowCheckIn(!showCheckIn)
              setShowAddFleet(false)
              setShowLogoUpload(false)
              setShowMyFleet(false)
              closeUnit()
            }}
            className="bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            {showCheckIn ? 'Close Check-In' : 'Check In a Unit'}
          </button>
        </div>

        {showMyFleet && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-4 sm:px-6 py-4 border-b border-zinc-800">
              <h2 className="text-lg font-semibold text-orange-400">My Fleet</h2>
              <p className="text-xs text-gray-500 mt-1">
                Every unit on your account, active or not - keep your serial numbers on hand in case a unit is ever lost or stolen and you need to report it.
              </p>
            </div>
            {units.length === 0 ? (
              <p className="px-4 sm:px-6 py-8 text-gray-500 text-sm">No units on your account yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-zinc-800">
                      <th className="px-4 sm:px-6 py-3">Model</th>
                      <th className="px-3 py-3">Category</th>
                      <th className="px-3 py-3">Serial Number</th>
                      <th className="px-3 py-3">Status</th>
                      <th className="px-3 py-3">Maintenance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {[...units]
                      .sort((a, b) => (a.model || a.nickname || '').localeCompare(b.model || b.nickname || ''))
                      .map(unit => (
                        <tr key={unit.id} className="hover:bg-zinc-800/40">
                          <td className="px-4 sm:px-6 py-3 font-medium">
                            {unit.model || '-'}
                            {unit.nickname && (
                              <span className="block text-xs text-gray-500 font-normal">{unit.nickname}</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-gray-300">{unit.equipment_type || '-'}</td>
                          <td className="px-3 py-3 font-mono text-orange-300">{unit.serial_number || '-'}</td>
                          <td className="px-3 py-3">
                            <span className={`inline-block text-xs px-2.5 py-1 rounded-full font-medium ${
                              unit.status === 'Needs Approval' ? 'bg-yellow-500/20 text-yellow-400'
                                : unit.status === 'Fleet' ? 'bg-zinc-600 text-gray-300'
                                : unit.status === 'Completed' || unit.status === 'Ready for Pickup' ? 'bg-green-500/20 text-green-400'
                                : unit.status === 'In Repair' ? 'bg-blue-500/20 text-blue-400'
                                : 'bg-orange-500/20 text-orange-400'
                            }`}>{unit.status}</span>
                            <span className="block text-xs text-gray-500 mt-1">
                              {ACTIVE_STATUSES.includes(unit.status) ? 'In for service' : 'With you'}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            {needsMaintenanceReminder(unit) ? (
                              <div
                                className="inline-flex flex-col"
                                title="It's been a while since this unit's last service. Regular maintenance helps avoid bigger, costlier repairs down the road."
                              >
                                <span className="inline-flex items-center gap-1.5 w-fit text-xs px-2.5 py-1 rounded-full font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
                                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                                  Checkup Recommended
                                </span>
                                <span className="text-xs text-gray-500 mt-1">
                                  {monthsSince(unit.last_service_date!)}+ months since last service
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-gray-600">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {showLogoUpload && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-6 space-y-4">
            <h2 className="text-lg font-semibold text-orange-400">Company Logo</h2>
            <p className="text-sm text-gray-500">
              Upload your logo. It appears at the top of your portal.
            </p>
            <div className="flex items-center gap-4">
              <img
                src={logoPreview || customer.logo_url || '/images/logo.png'}
                alt="Logo preview"
                className="h-16 w-16 object-contain rounded-lg border border-zinc-700 bg-zinc-950"
              />
              <div className="space-y-2">
                <label className="inline-flex items-center justify-center bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg cursor-pointer">
                  Choose Logo
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => onLogoPick(e.target.files?.[0] || null)}
                  />
                </label>
                {logoFile && (
                  <button
                    onClick={saveLogo}
                    disabled={logoBusy}
                    className="block bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
                  >
                    {logoBusy ? 'Uploading...' : 'Save Logo'}
                  </button>
                )}
                {customer.logo_url && !logoFile && (
                  <button
                    onClick={removeLogo}
                    disabled={logoBusy}
                    className="block text-sm text-red-400 hover:text-red-300 disabled:opacity-50"
                  >
                    Remove logo
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {showAddFleet && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-orange-400 mb-1">Add Unit to Fleet</h2>
            <p className="text-sm text-gray-500 mb-4">
              Register equipment you own so you can schedule service later.
            </p>
            <form onSubmit={handleAddFleet} className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Model</label>
                <input
                  value={fleetModel}
                  onChange={e => handleFleetModelChange(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  placeholder="e.g. MS 462"
                />
              </div>
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
                <label className="block text-xs text-gray-500 mb-1">Unit Type</label>
                <select
                  value={fleetType}
                  onChange={e => handleFleetTypeChange(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select equipment type</option>
                  {EQUIPMENT_CATEGORIES.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                {fleetType === 'Other' && (
                  <input
                    value={fleetCustomType}
                    onChange={e => setFleetCustomType(e.target.value)}
                    placeholder="Describe equipment type (e.g. battery unit)"
                    className="mt-2 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  />
                )}
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
              {fleetType === 'Riding Lawn Mower' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Hour meter (optional)</label>
                  <input
                    value={fleetHours}
                    onChange={e => setFleetHours(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                    placeholder="e.g. 142.5"
                    inputMode="decimal"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Thumbnail photo (optional)</label>
                <input
                  type="file"
                  accept="image/*"
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

        {showCheckIn && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-orange-400 mb-1">Check In a Unit</h2>
            <p className="text-sm text-gray-500 mb-4">
              Tell us what's coming in. Jesse can correct any details after pickup.
            </p>
            <form onSubmit={handleCheckIn} className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Model</label>
                <input
                  value={model}
                  onChange={e => handleModelChange(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  placeholder="e.g. MS 462"
                />
              </div>
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
                <label className="block text-xs text-gray-500 mb-1">Unit Type</label>
                <select
                  value={unitType}
                  onChange={e => handleUnitTypeChange(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select equipment type</option>
                  {EQUIPMENT_CATEGORIES.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                {unitType === 'Other' && (
                  <input
                    value={customUnitType}
                    onChange={e => setCustomUnitType(e.target.value)}
                    placeholder="Describe equipment type (e.g. battery unit)"
                    className="mt-2 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  />
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">What's wrong</label>
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

        {selectedUnit && (
          <div className="bg-zinc-900 border border-orange-500/40 rounded-xl p-4 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex gap-3 min-w-0">
                <UnitPhoto unit={selectedUnit} size="h-16 w-16" />
                <div className="min-w-0">
                  <p className="font-semibold text-lg truncate">{displayName(selectedUnit)}</p>
                  <p className="text-sm text-gray-400">
                    Serial: {selectedUnit.serial_number || '-'}
                    {selectedUnit.nickname ? ` - ${selectedUnit.nickname}` : ''}
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

            {canEditDetails && (
              <div className="space-y-3 border-t border-zinc-800 pt-4">
                <p className="text-sm font-medium text-orange-300">Edit unit details</p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Model</label>
                    <input
                      value={editModel}
                      onChange={e => handleEditModelChange(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Serial Number *</label>
                    <input
                      value={editSerial}
                      onChange={e => setEditSerial(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Unit Type</label>
                    <select
                      value={editType}
                      onChange={e => handleEditTypeChange(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">Select equipment type</option>
                      {EQUIPMENT_CATEGORIES.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    {editType === 'Other' && (
                      <input
                        value={editCustomType}
                        onChange={e => setEditCustomType(e.target.value)}
                        placeholder="Describe equipment type (e.g. battery unit)"
                        className="mt-2 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Nickname</label>
                    <input
                      value={editNickname}
                      onChange={e => setEditNickname(e.target.value)}
                      placeholder="e.g. Shop mower #2"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  {editType === 'Riding Lawn Mower' && (
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">Hour meter</label>
                      <input
                        value={editHours}
                        onChange={e => setEditHours(e.target.value)}
                        placeholder="e.g. 142.5"
                        inputMode="decimal"
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                  )}
                </div>
                <button
                  onClick={saveUnitDetails}
                  disabled={detailBusy}
                  className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
                >
                  {detailBusy ? 'Saving...' : 'Save Details'}
                </button>
              </div>
            )}

            {!canEditDetails && (
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
                    onClick={saveUnitDetails}
                    disabled={detailBusy}
                    className="bg-zinc-700 hover:bg-zinc-600 text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs text-gray-500 mb-1">Unit thumbnail photo</label>
              <div className="flex flex-col gap-3">
                {thumbPreview && (
                  <img
                    src={thumbPreview}
                    alt="New thumbnail preview"
                    className="h-24 w-24 object-cover rounded-lg border border-orange-500/50"
                  />
                )}
                <label className="inline-flex items-center justify-center bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg cursor-pointer w-full sm:w-auto">
                  {thumbFile ? 'Choose Different Photo' : 'Choose Photo'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => onThumbPick(e.target.files?.[0] || null)}
                  />
                </label>
                {thumbFile && (
                  <button
                    onClick={saveThumbnail}
                    disabled={detailBusy}
                    className="bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg w-full sm:w-auto"
                  >
                    {detailBusy ? 'Uploading...' : 'Save Thumbnail'}
                  </button>
                )}
              </div>
            </div>

            {canEditDetails && (
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

            {(selectedUnit.status === 'Repair Requested' || selectedUnit.status === 'Diagnosing') && (
              <div className="border-t border-zinc-800 pt-4">
                <button
                  onClick={withdrawService}
                  disabled={detailBusy}
                  className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
                >
                  Withdraw Service {'->'} Back to Fleet
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
            </div>
          </div>
        )}

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

        <details className="group" open={fleetUnits.length > 0 && fleetUnits.length <= 6}>
          <summary className="cursor-pointer list-none flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 hover:border-orange-500/40 transition">
            <h2 className="text-lg font-semibold text-orange-300">
              Fleet ({fleetUnits.length})
            </h2>
            <span className="text-gray-500 text-sm group-open:rotate-180 transition">v</span>
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

        <details className="group">
          <summary className="cursor-pointer list-none flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 hover:border-orange-500/40 transition">
            <h2 className="text-lg font-semibold text-gray-300">
              Other Units ({otherUnits.length})
            </h2>
            <span className="text-gray-500 text-sm group-open:rotate-180 transition">v</span>
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

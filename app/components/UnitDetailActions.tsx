'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { liveTitleCase, toTitleCase } from '@/lib/text'
import { STIHL_PREFIX_MAP, EQUIPMENT_CATEGORIES } from '@/lib/units'
import { notifyAdminPush } from '@/lib/notifyAdminPush'

const supabase = createClient()

type ActionUnit = {
  id: string
  status: string
  nickname: string | null
  serial_number: string
  model: string | null
  equipment_type: string | null
  hour_meter: string | null
}

type UnitUpdates = Partial<Pick<ActionUnit, 'nickname' | 'serial_number' | 'model' | 'equipment_type' | 'hour_meter'>> & {
  thumbnail_url?: string
}

// Everything a customer can DO to a unit from its detail panel - edit its
// details, change its thumbnail, request service, withdraw a pending
// request. Shares one busy flag (lifted to the parent, since the
// "Remove from my list" button further down the panel also disables on
// it) across all of these actions, same as before this was its own
// component.
//
// Caller must render this with key={unit.id} - switching units needs a
// fresh mount (editable fields seeded from the new unit, not carrying
// over the previous unit's in-progress edits).
export default function UnitDetailActions({
  unit,
  customerName,
  busy,
  onBusyChange,
  onMessage,
  onLoadData,
  onUnitUpdated,
  onClose,
}: {
  unit: ActionUnit
  customerName: string
  busy: boolean
  onBusyChange: (busy: boolean) => void
  onMessage: (message: string) => void
  onLoadData: () => Promise<void>
  onUnitUpdated: (updates: UnitUpdates) => void
  onClose: () => void
}) {
  const canEditDetails = unit.status === 'Fleet' || unit.status === 'Registered'

  const [editNickname, setEditNickname] = useState(unit.nickname || '')
  const [editSerial, setEditSerial] = useState(unit.serial_number || '')
  const [editModel, setEditModel] = useState(unit.model || '')
  const [editType, setEditType] = useState(unit.equipment_type || '')
  const [editCustomType, setEditCustomType] = useState('')
  const [editTypeManuallySet, setEditTypeManuallySet] = useState(false)
  const [editHours, setEditHours] = useState(unit.hour_meter || '')
  const [thumbFile, setThumbFile] = useState<File | null>(null)
  const [thumbPreview, setThumbPreview] = useState<string | null>(null)
  const [serviceNote, setServiceNote] = useState('')

  useEffect(() => {
    return () => {
      if (thumbPreview) URL.revokeObjectURL(thumbPreview)
    }
  }, [thumbPreview])

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

  function onThumbPick(file: File | null) {
    setThumbFile(file)
    setThumbPreview(file ? URL.createObjectURL(file) : null)
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

  async function saveUnitDetails() {
    if (!editSerial.trim()) {
      onMessage('Serial number is required.')
      return
    }
    onBusyChange(true)
    const finalEditType = editType === 'Other' && editCustomType.trim() ? editCustomType.trim() : editType
    const finalEditHours = editType === 'Riding Lawn Mower' ? (editHours.trim() || null) : null
    const { error } = await supabase
      .from('units')
      .update({
        nickname: editNickname.trim() ? toTitleCase(editNickname) : null,
        serial_number: editSerial.trim(),
        model: editModel.trim() || null,
        equipment_type: finalEditType || null,
        hour_meter: finalEditHours,
      })
      .eq('id', unit.id)
    onBusyChange(false)
    if (error) {
      console.error(error)
      onMessage('Could not save changes.')
      return
    }
    onMessage('Unit details saved.')
    await onLoadData()
    onUnitUpdated({
      nickname: editNickname.trim() ? toTitleCase(editNickname) : null,
      serial_number: editSerial.trim(),
      model: editModel.trim() || null,
      equipment_type: finalEditType || null,
      hour_meter: finalEditHours,
    })
  }

  async function saveThumbnail() {
    if (!thumbFile) return
    onBusyChange(true)
    try {
      const url = await uploadFile(thumbFile, `thumb-${unit.id}`)
      const { error } = await supabase
        .from('units')
        .update({ thumbnail_url: url })
        .eq('id', unit.id)
      if (error) throw error
      onMessage('Thumbnail updated.')
      onThumbPick(null)
      await onLoadData()
      onUnitUpdated({ thumbnail_url: url })
    } catch (err) {
      console.error(err)
      onMessage('Could not upload thumbnail.')
    }
    onBusyChange(false)
  }

  async function requestService() {
    onBusyChange(true)
    const note = serviceNote.trim() || 'Customer requested tune-up / service'
    const historyLine = `${new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })} - Service requested by ${customerName}: ${note}`
    const { data: existing } = await supabase
      .from('units')
      .select('notes, history')
      .eq('id', unit.id)
      .single()
    const { error } = await supabase
      .from('units')
      .update({
        status: 'Repair Requested',
        status_since: new Date().toISOString(),
        problem_type: note,
        notes: existing?.notes ? `${note}\n${existing.notes}` : note,
        notes_updated_at: new Date().toISOString(),
        decision_seen: true,
        history: existing?.history ? `${historyLine}\n${existing.history}` : historyLine,
      })
      .eq('id', unit.id)
    onBusyChange(false)
    if (error) {
      console.error(error)
      onMessage('Could not request service.')
      return
    }
    notifyAdminPush('service_request', unit.id)
    onMessage('Service requested. Jesse has been notified.')
    await onLoadData()
    onClose()
  }

  async function withdrawService() {
    if (!confirm('Withdraw this service request? The unit will go back to your fleet list.')) return
    onBusyChange(true)
    const historyLine = `${new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })} - Service withdrawn by ${customerName} - returned to fleet`
    const { data: existing } = await supabase
      .from('units')
      .select('history')
      .eq('id', unit.id)
      .single()
    const { error } = await supabase
      .from('units')
      .update({
        status: 'Fleet',
        status_since: new Date().toISOString(),
        problem_type: null,
        decision_seen: true,
        history: existing?.history ? `${historyLine}\n${existing.history}` : historyLine,
      })
      .eq('id', unit.id)
    onBusyChange(false)
    if (error) {
      console.error(error)
      onMessage('Could not withdraw service request.')
      return
    }
    onMessage('Service request withdrawn. Unit is back on your fleet list.')
    onClose()
    await onLoadData()
  }

  return (
    <>
      {canEditDetails && (
        <div className="space-y-3 border-t border-zinc-800 pt-3">
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
                onChange={e => setEditNickname(liveTitleCase(e.target.value))}
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
            disabled={busy}
            className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            {busy ? 'Saving...' : 'Save Details'}
          </button>
        </div>
      )}

      <div className="border-t border-zinc-800 pt-3">
        <label className="block text-xs text-gray-500 mb-1">Unit thumbnail photo</label>
        <p className="text-xs text-gray-600 mb-2">Update this any time - e.g. after you&apos;ve cleaned it up.</p>
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
              disabled={busy}
              className="bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg w-full sm:w-auto"
            >
              {busy ? 'Uploading...' : 'Save Thumbnail'}
            </button>
          )}
        </div>
      </div>

      {canEditDetails && (
        <div className="border-t border-zinc-800 pt-3">
          <label className="block text-xs text-gray-500 mb-1">Request service / tune-up</label>
          <input
            value={serviceNote}
            onChange={e => setServiceNote(e.target.value)}
            placeholder="e.g. Due for 3-month tune-up..."
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm mb-2"
          />
          <button
            onClick={requestService}
            disabled={busy}
            className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            Schedule Service
          </button>
        </div>
      )}

      {(unit.status === 'Repair Requested' || unit.status === 'Received' || unit.status === 'Diagnosing') && (
        <div className="border-t border-zinc-800 pt-3">
          <button
            onClick={withdrawService}
            disabled={busy}
            className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            Withdraw Service {'->'} Back to Fleet
          </button>
        </div>
      )}
    </>
  )
}

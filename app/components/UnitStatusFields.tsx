'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'

// Diagnosis Notes (what was actually found wrong) is required before a
// unit can move past Diagnosing into Needs Approval or In Repair, so its
// "required" state needs to react to whatever the admin currently has
// selected in the status <select> - even though the <select> itself lives
// in the compact action row up top, while Diagnosis Notes needs to render
// further down the page (after the Photos gallery). A shared context lets
// StatusSelect and DiagnosisNotesField be two independent client
// components, rendered wherever UnitDetailPanel needs them, that both
// read/write the same `status` value without any DOM lookup or portal -
// both carry `form={formId}` so they still submit together with
// updateStatus even though neither is physically inside the <form> tag.
type StatusContextValue = {
  status: string
  setStatus: (status: string) => void
}

const StatusContext = createContext<StatusContextValue | null>(null)

export function UnitStatusProvider({
  initialStatus,
  children,
}: {
  initialStatus: string
  children: ReactNode
}) {
  const [status, setStatus] = useState(initialStatus)
  return <StatusContext.Provider value={{ status, setStatus }}>{children}</StatusContext.Provider>
}

function useStatusContext() {
  const ctx = useContext(StatusContext)
  if (!ctx) throw new Error('StatusSelect/DiagnosisNotesField must render inside UnitStatusProvider')
  return ctx
}

export function StatusSelect({ formId }: { formId: string }) {
  const { status, setStatus } = useStatusContext()

  return (
    <select
      form={formId}
      name="status"
      value={status}
      onChange={e => setStatus(e.target.value)}
      className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
    >
      <option value="Repair Requested">Repair Requested</option>
      <option value="Received">Received / Checked In</option>
      <option value="Diagnosing">Diagnosing</option>
      <option value="Needs Approval">Needs Approval</option>
      <option value="In Repair">In Repair</option>
      <option value="Deny Repair">Deny Repair</option>
      <option value="Ready for Pickup">Ready for Pickup</option>
    </select>
  )
}

type StatusFieldsUnit = {
  diagnosis_notes: string | null
  diagnosis_notes_updated_at: string | null
}

export function DiagnosisNotesField({ unit, formId }: { unit: StatusFieldsUnit; formId: string }) {
  const { status } = useStatusContext()

  const hasDiagnosisNotes = !!unit.diagnosis_notes
  const needsDiagnosisNotes = (status === 'Needs Approval' || status === 'In Repair') && !hasDiagnosisNotes

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <label className="block text-xs font-bold text-orange-300">Diagnosis Notes</label>
        {unit.diagnosis_notes_updated_at && (
          <span className="text-xs text-orange-400 bg-orange-500/10 border border-orange-500/30 rounded-full px-2 py-0.5">
            Updated {new Date(unit.diagnosis_notes_updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>
      <p className="text-xs text-gray-600 mb-1">
        What was actually found wrong - visible to the customer. Add any parts needed in Parts &amp; SKUs below.
      </p>
      <textarea
        form={formId}
        name="diagnosis_notes"
        defaultValue={unit.diagnosis_notes || ''}
        rows={2}
        required={needsDiagnosisNotes}
        placeholder="What was found during diagnosis..."
        className="w-full bg-zinc-900 border border-orange-500/40 rounded-lg px-3 py-2 text-sm text-orange-100"
      />
      {needsDiagnosisNotes && (
        <p className="text-xs text-orange-400 mt-1">Required before moving to {status}.</p>
      )}
    </div>
  )
}

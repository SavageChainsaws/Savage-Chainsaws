'use client'

import { useState } from 'react'

// Diagnosis Notes (what was actually found wrong) is required before a
// unit can move past Diagnosing into Needs Approval or In Repair - it's a
// separate field from Customer Notes (what the customer said at check-in),
// never an overwrite of it, so both stay visible side by side. The status
// <select> has to live in this client component (rather than the plain
// server-action form around it) so the "required" state on the Diagnosis
// Notes field can react to what's currently selected, before the admin
// even submits.
type StatusFieldsUnit = {
  status: string
  notes: string | null
  diagnosis_notes: string | null
  diagnosis_notes_updated_at: string | null
}

export default function UnitStatusFields({ unit }: { unit: StatusFieldsUnit }) {
  const [status, setStatus] = useState<string>(unit.status)
  const hasDiagnosisNotes = !!unit.diagnosis_notes
  const needsDiagnosisNotes = (status === 'Needs Approval' || status === 'In Repair') && !hasDiagnosisNotes

  return (
    <>
      <select
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
        <option value="Ready for Pickup">Ready for Pickup</option>
      </select>

      {/* Customer Notes (blue) vs. Diagnosis Notes (orange) - distinct colors
          in addition to both being bold, so it's obvious at a glance which
          voice/stage each note is from. */}
      <div className="w-full mt-3 space-y-3">
        <div>
          <label className="block text-xs font-bold text-blue-300 mb-1">Customer Notes</label>
          <p className="text-xs text-gray-600 mb-1">What the customer reported at check-in.</p>
          <textarea name="notes" defaultValue={unit.notes || ''} rows={2} placeholder="Customer notes..." className="w-full bg-zinc-900 border border-blue-500/40 rounded-lg px-3 py-2 text-sm text-blue-100" />
        </div>

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
      </div>
    </>
  )
}

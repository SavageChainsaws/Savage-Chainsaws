'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'

// Unit Type/Model and Serial Number are usually only confirmed at
// check-in, but teardown/diagnosis sometimes reveals the real model or a
// serial hidden until the engine block is exposed - this lets an admin
// correct them in place rather than deleting and re-adding the unit. One
// pencil control gates edit mode for both the bold model/type description
// (UnitDescriptionField, rendered where the label already sits) and the
// Serial Number box (UnitIdentityBox, rendered to its right), so they
// share one context rather than needing two separate controls. Both
// submit through the same physical <form> that UnitIdentityBox owns -
// UnitDescriptionField's inputs associate to it by id via `form={formId}`
// since they're not DOM descendants of it.
//
// Warranty (WarrantyBox, below) is deliberately NOT part of that shared
// edit-mode/context - it's its own always-visible, always-interactive
// Yes/No toggle sitting next to the Serial box, with its own action and
// form, so admins can flip it without first clicking the identity pencil.
type IdentityContextValue = {
  isEditing: boolean
  setIsEditing: (v: boolean) => void
  formId: string
}

const IdentityContext = createContext<IdentityContextValue | null>(null)

export function UnitIdentityProvider({
  formId,
  children,
}: {
  formId: string
  children: ReactNode
}) {
  const [isEditing, setIsEditing] = useState(false)
  return (
    <IdentityContext.Provider value={{ isEditing, setIsEditing, formId }}>
      {children}
    </IdentityContext.Provider>
  )
}

function useIdentityContext() {
  const ctx = useContext(IdentityContext)
  if (!ctx) throw new Error('UnitDescriptionField/UnitIdentityBox must render inside UnitIdentityProvider')
  return ctx
}

// This whole editor lives inside a <summary> - without stopping
// propagation, clicking any control here would also toggle the parent
// <details> open/closed via the browser's native summary click handling.
function stopClickBubble(e: { stopPropagation: () => void }) {
  e.stopPropagation()
}

const EQUIPMENT_TYPES = [
  'Riding Mower', 'Walk-Behind Mower', 'Chainsaw', 'Pole Saw', 'String Trimmer',
  'Hedge Trimmer', 'Blower', 'Backpack Blower', 'Edger', 'Cutquik', 'Other',
]

type IdentityUnit = {
  id: string
  model: string | null
  equipment_type: string | null
  serial_number: string | null
  warranty_end: string | null
}

export function UnitDescriptionField({ unit, label }: { unit: IdentityUnit; label: string }) {
  const { isEditing, formId } = useIdentityContext()

  if (!isEditing) {
    return <p className="font-bold truncate">{label}</p>
  }

  const typeOptions = unit.equipment_type && !EQUIPMENT_TYPES.includes(unit.equipment_type)
    ? [unit.equipment_type, ...EQUIPMENT_TYPES]
    : EQUIPMENT_TYPES

  return (
    <div className="flex flex-wrap gap-1.5" onClick={stopClickBubble}>
      <input
        form={formId}
        name="model"
        defaultValue={unit.model || ''}
        placeholder="Model"
        className="w-28 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
      />
      <select
        form={formId}
        name="equipment_type"
        defaultValue={unit.equipment_type || ''}
        className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
      >
        <option value="">Type...</option>
        {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
    </div>
  )
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

export function UnitIdentityBox({
  unit,
  action,
}: {
  unit: IdentityUnit
  action: (formData: FormData) => void
}) {
  const { isEditing, setIsEditing, formId } = useIdentityContext()
  const [copied, setCopied] = useState(false)

  async function handleCopy(e: { stopPropagation: () => void }) {
    e.stopPropagation()
    if (!unit.serial_number) return
    try {
      await navigator.clipboard.writeText(unit.serial_number)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.error('Could not copy serial number:', err)
    }
  }

  if (!isEditing) {
    return (
      <div className="flex items-center gap-2 shrink-0" onClick={stopClickBubble}>
        <span className="text-xs px-2.5 py-1 rounded-full bg-zinc-700 text-yellow-300 font-semibold flex items-center gap-1.5">
          Serial: {unit.serial_number || '-'}
          {unit.serial_number && (
            <button
              type="button"
              onClick={handleCopy}
              className="text-yellow-300/70 hover:text-yellow-200"
              title="Copy serial number"
              aria-label="Copy serial number"
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          )}
        </span>
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="text-gray-500 hover:text-orange-400 text-sm px-1"
          title="Edit unit type & serial number"
          aria-label="Edit unit details"
        >
          &#9998;
        </button>
      </div>
    )
  }

  return (
    <form
      id={formId}
      action={action}
      onClick={stopClickBubble}
      className="flex flex-wrap items-center gap-2 shrink-0 bg-zinc-800/60 border border-zinc-700 rounded-lg px-2 py-1.5"
    >
      <input type="hidden" name="id" value={unit.id} />
      <input
        required
        name="serial_number"
        defaultValue={unit.serial_number || ''}
        placeholder="Serial number"
        className="w-32 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
      />
      <button type="submit" className="bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg">
        Save
      </button>
      <button
        type="button"
        onClick={() => setIsEditing(false)}
        className="text-gray-400 hover:text-white text-xs px-2 py-1.5"
      >
        Cancel
      </button>
    </form>
  )
}

// Standalone - unlike Model/Type/Serial, the Warranty Yes/No toggle is
// always visible and interactive right next to the Serial box, not gated
// behind the pencil/edit control, and submits through its own action
// (updateUnitWarranty) so it never touches the identity fields. Reuses
// the same "is this unit currently under warranty" rule (warranty_end >=
// today) that the Fleet section's "Under Warranty" pill already uses,
// just as the live toggle's initial position instead of a read-only pill.
export function WarrantyBox({
  unit,
  action,
}: {
  unit: { id: string; warranty_end: string | null }
  action: (formData: FormData) => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const initiallyUnderWarranty = !!unit.warranty_end && unit.warranty_end >= today
  const [warrantyOn, setWarrantyOn] = useState(initiallyUnderWarranty)

  return (
    <form
      action={action}
      onClick={stopClickBubble}
      className="flex flex-wrap items-center gap-1.5 shrink-0 bg-zinc-800/60 border border-zinc-700 rounded-full pl-3 pr-1.5 py-1 text-xs text-gray-300"
    >
      <input type="hidden" name="id" value={unit.id} />
      <span className="text-gray-400">Warranty:</span>
      <label className="flex items-center gap-0.5 cursor-pointer">
        <input type="radio" name="is_under_warranty" value="true" checked={warrantyOn} onChange={() => setWarrantyOn(true)} /> Yes
      </label>
      <label className="flex items-center gap-0.5 cursor-pointer">
        <input type="radio" name="is_under_warranty" value="false" checked={!warrantyOn} onChange={() => setWarrantyOn(false)} /> No
      </label>
      {warrantyOn && (
        <input
          type="date"
          name="warranty_end"
          defaultValue={unit.warranty_end || ''}
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs"
        />
      )}
      <button type="submit" className="bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium px-2.5 py-1 rounded-full">
        Save
      </button>
    </form>
  )
}

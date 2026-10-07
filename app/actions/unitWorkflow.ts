'use server'

import { revalidatePath } from 'next/cache'
import { getSessionInfo } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email'
import { sendPushToCustomer } from '@/lib/push'
import { stampHistory, unitLabel, PRIORITY_FEE } from '@/lib/units'

export async function scheduleFleetService(formData: FormData) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  const note = (formData.get('service_note') as string) || ''
  const { data: existing } = await supabase
    .from('units')
    .select('history, notes')
    .eq('id', id)
    .single()

  const entry = note.trim()
    ? `Scheduled for service: ${note.trim()}`
    : 'Scheduled for service from fleet'

  await supabase.from('units').update({
    status: 'Repair Requested',
    status_since: new Date().toISOString(),
    decision_seen: true,
    problem_type: note.trim() || 'Service requested from fleet',
    notes: existing?.notes ? `${entry}\n${existing.notes}` : entry,
    notes_updated_at: new Date().toISOString(),
    history: stampHistory(existing?.history, entry),
  }).eq('id', id)

  revalidatePath('/')
}

export async function returnToFleet(formData: FormData) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  const { data: existing } = await supabase
    .from('units')
    .select('history')
    .eq('id', id)
    .single()

  await supabase.from('units').update({
    status: 'Fleet',
    status_since: new Date().toISOString(),
    decision_seen: true,
    problem_type: null,
    history: stampHistory(existing?.history, 'Withdrawn from shop - returned to fleet'),
  }).eq('id', id)

  revalidatePath('/')
}

export async function markPickedUp(formData: FormData) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  const pickedUpBy = (formData.get('picked_up_by') as string || '').trim()
  if (!id || !pickedUpBy) return

  const { data: existing } = await supabase
    .from('units')
    .select('status, history')
    .eq('id', id)
    .single()
  // Only allowed once the work is actually done - guards against a stale
  // form being submitted against a unit that moved on in the meantime.
  if (!existing || existing.status !== 'Ready for Pickup') return

  await supabase.from('units').update({
    status: 'Fleet',
    status_since: new Date().toISOString(),
    decision_seen: true,
    picked_up_by: pickedUpBy,
    picked_up_at: new Date().toISOString(),
    history: stampHistory(existing.history, `Picked up by ${pickedUpBy}`),
  }).eq('id', id)

  revalidatePath('/')
}

// DIAGNOSTIC_FEE is the deny-repair charge, matching the customer portal's
// own deny flow exactly (same $49.99, same service_history description
// shape) so a repair denied from either side looks identical afterward -
// only used here, unlike PRIORITY_FEE (see lib/units.ts).
const DIAGNOSTIC_FEE = 49.99

export async function updateStatus(formData: FormData) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  let status = formData.get('status') as string
  const notes = formData.get('notes') as string
  const diagnosisNotesRaw = formData.get('diagnosis_notes') as string
  const diagnosisNotes = diagnosisNotesRaw?.trim() || null
  const file = formData.get('invoice') as File
  const isPriority = formData.get('is_priority') === 'true'
  const { data: existing } = await supabase
    .from('units')
    .select('status, history, is_priority, problem_type, notes, diagnosis_notes, customer_id, model, equipment_type, nickname, serial_number')
    .eq('id', id)
    .single()
  const wasAlreadyDone = existing ? existing.status === 'Ready for Pickup' : false

  // "Deny Repair" is a dropdown trigger, not a real persisted status - it
  // resolves to the same status (and the same $49.99 diagnostic fee logged
  // to Service History) as the customer's own deny action, just admin-
  // initiated instead of customer-initiated.
  const isDenyRepair = status === 'Deny Repair'
  if (isDenyRepair) {
    status = 'Ready for Pickup'
  }

  // Diagnosis Notes (what was actually found wrong) must exist before a
  // unit leaves Diagnosing - a separate field from the customer's own
  // check-in notes, never overwriting it. Block the status change (keep
  // it where it is) rather than silently letting a unit through without
  // findings recorded; everything else on the form still saves. Denying
  // doesn't need fresh findings - the unit is going back to the customer
  // as-is.
  const requiresDiagnosisNotes = !isDenyRepair && (status === 'Needs Approval' || status === 'In Repair') && !diagnosisNotes
  if (requiresDiagnosisNotes && existing) {
    status = existing.status
  }

  const denyNote = 'Denied by Savage Chainsaws - diagnosis fee $49.99 will apply'
  const finalNotes = isDenyRepair ? (notes ? `${denyNote}\n${notes}` : denyNote) : (notes || null)
  const updateData: any = {
    status,
    notes: finalNotes,
    is_priority: isPriority,
    expedite_fee: isPriority ? PRIORITY_FEE : null,
  }
  if (finalNotes !== (existing?.notes ?? null)) {
    updateData.notes_updated_at = new Date().toISOString()
  }
  if (diagnosisNotes && diagnosisNotes !== existing?.diagnosis_notes) {
    updateData.diagnosis_notes = diagnosisNotes
    updateData.diagnosis_notes_updated_at = new Date().toISOString()
  }
  if (existing && existing.status !== status) {
    updateData.history = stampHistory(existing.history, isDenyRepair ? 'Denied - diagnostic fee applied' : `Status -> ${status}`)
    updateData.status_since = new Date().toISOString()
  }
  if (status === 'Ready for Pickup') {
    updateData.last_service_date = new Date().toISOString().split('T')[0]
    // Log a service history entry the first time a unit reaches Ready for
    // Pickup (not on a resubmit that leaves status unchanged) - covers a
    // unit closed out right at check-in, mid-repair, denied at diagnosis,
    // or through the normal completion flow, since they all pass through
    // this same status update.
    if (!wasAlreadyDone) {
      if (isDenyRepair) {
        await supabase.from('service_history').insert({
          unit_id: id,
          description: 'Diagnostic fee - repair denied',
          cost: DIAGNOSTIC_FEE,
        })
      } else {
        await supabase.from('service_history').insert({
          unit_id: id,
          description: diagnosisNotes || existing?.diagnosis_notes || notes || existing?.problem_type || 'Service completed',
          cost: null,
        })
      }
    }
  }
  if (file && typeof file === 'object' && 'size' in file && file.size > 0) {
    try {
      const bytes = await file.arrayBuffer()
      const fileName = `${id}-${Date.now()}-${file.name || 'file'}`
      const { error: uploadError } = await supabase.storage
        .from('invoices')
        .upload(fileName, bytes, {
          contentType: file.type || 'application/octet-stream',
          upsert: false,
        })
      if (!uploadError) {
        const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(fileName)
        updateData.invoice_url = publicUrl
        updateData.history = stampHistory(updateData.history || existing?.history, 'File uploaded')
      }
    } catch {
      // ignore
    }
  }
  await supabase.from('units').update(updateData).eq('id', id)

  // Push on top of the in-app badges, only on an actual transition into one
  // of these two states - never on a resubmit that leaves status unchanged.
  if (existing && existing.customer_id && existing.status !== status) {
    const label = unitLabel(existing)
    if (status === 'Needs Approval') {
      await sendPushToCustomer(existing.customer_id, {
        title: 'Diagnosis ready for your decision',
        body: `Your ${label} is ready for approval - review the diagnosis and quote.`,
        url: '/customer',
        tag: `unit-${id}`,
      })
    } else if (status === 'Ready for Pickup' && !wasAlreadyDone) {
      await sendPushToCustomer(existing.customer_id, {
        title: 'Ready for pickup',
        body: `Your ${label} is ready for pickup!`,
        url: '/customer',
        tag: `unit-${id}`,
      })
    }
  }
  revalidatePath('/')
}

export async function markDecisionSeen(formData: FormData) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  await supabase.from('units').update({ decision_seen: true }).eq('id', id)
  revalidatePath('/')
}

export async function snoozeUnit(formData: FormData) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  const days = Number(formData.get('days') || 7)
  const snoozeUntil = new Date()
  snoozeUntil.setDate(snoozeUntil.getDate() + days)
  const { data: existing } = await supabase.from('units').select('history').eq('id', id).single()
  await supabase
    .from('units')
    .update({
      snoozed_until: snoozeUntil.toISOString(),
      decision_seen: true,
      history: stampHistory(existing?.history, `Snoozed ${days} days`),
    })
    .eq('id', id)
  revalidatePath('/')
}

// Lightweight "don't forget about this" ping - distinct from the full
// status-change flow (updateStatus), which is what actually moves the job
// forward. Never blocks or errors out when email isn't configured yet or
// the customer has no address on file - it just logs why nothing went out
// so that's visible in the unit's History instead of failing silently.
export async function nudgeUnit(formData: FormData) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  const { data: unit } = await supabase
    .from('units')
    .select('customer_id, model, equipment_type, nickname, serial_number, status, history')
    .eq('id', id)
    .single()
  if (!unit) return

  const { data: customer } = await supabase
    .from('customers')
    .select('name, email, secondary_email')
    .eq('id', unit.customer_id)
    .single()

  // Sends to both the primary and secondary email when both are on file -
  // e.g. an owner and a manager - not just whichever was set first.
  const recipients = [customer?.email, customer?.secondary_email].filter(
    (e): e is string => !!e
  )

  if (recipients.length === 0) {
    await supabase.from('units').update({
      history: stampHistory(unit.history, 'Nudge attempted - no email on file for customer'),
    }).eq('id', id)
    revalidatePath('/')
    return
  }

  const label = unitLabel(unit)
  const result = await sendEmail({
    to: recipients,
    subject: `Reminder: ${label} at Savage Chainsaws`,
    html: `<p>Hi ${customer?.name || 'there'},</p><p>Just a quick reminder about your <strong>${label}</strong> - it's currently <strong>${unit.status}</strong>. Log in to your portal any time for the latest update.</p>`,
    // Sent from a no-reply domain sender - route any reply to a real
    // monitored inbox instead of the sending address.
    replyTo: 'service@savagechainsaws.com',
  })

  await supabase.from('units').update({
    history: stampHistory(
      unit.history,
      result.ok ? `Reminder emailed to ${recipients.join(', ')}` : `Nudge attempted - ${result.error}`
    ),
  }).eq('id', id)
  revalidatePath('/')
}

// Admin's side of the messages thread - previously read-only (see
// UnitReplies in app/page.tsx). Reuses the same messages table as the
// customer's own questions, distinguished by is_admin, so both sides
// render from one ordered list instead of two separate ones.
export async function replyToMessage(formData: FormData) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const unitId = formData.get('unit_id') as string
  const message = (formData.get('message') as string || '').trim()
  if (!unitId || !message) return

  const { data: unit } = await supabase.from('units').select('customer_id').eq('id', unitId).single()
  if (!unit?.customer_id) return

  await supabase.from('messages').insert({
    unit_id: unitId,
    customer_id: unit.customer_id,
    is_admin: true,
    message,
  })

  await sendPushToCustomer(unit.customer_id, {
    title: 'New reply from Savage Chainsaws',
    body: message.length > 120 ? `${message.slice(0, 117)}...` : message,
    url: '/customer',
    tag: `unit-${unitId}`,
  })

  revalidatePath('/')
}

export async function updateNotes(_prevState: { savedAt: number } | null, formData: FormData) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  const notes = formData.get('notes') as string
  await supabase.from('units').update({ notes: notes || null, notes_updated_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/')
  return { savedAt: Date.now() }
}

// Replaces a unit's thumbnail at any time, regardless of status - previously
// thumbnail_url could only ever be set once, during check-in (addUnit); if
// that step was skipped (unknown model/serial at drop-off, etc.) there was
// no way back in short of deleting and re-adding the whole unit. Same
// 'invoices' bucket every other unit-photo upload already uses in this app.
export async function updateThumbnail(_prevState: { savedAt: number } | null, formData: FormData): Promise<{ savedAt: number } | null> {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  const file = formData.get('thumbnail') as File
  if (!id || !file || typeof file !== 'object' || !('size' in file) || file.size === 0) return null

  const bytes = await file.arrayBuffer()
  const fileName = `${id}-thumb-${Date.now()}-${file.name || 'photo'}`
  const { error: uploadError } = await supabase.storage
    .from('invoices')
    .upload(fileName, bytes, { contentType: file.type || 'image/jpeg', upsert: false })
  if (uploadError) return null

  const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(fileName)
  await supabase.from('units').update({ thumbnail_url: publicUrl }).eq('id', id)
  revalidatePath('/')
  return { savedAt: Date.now() }
}

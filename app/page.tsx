import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import Link from 'next/link'
import { createClient, getSessionInfo } from '@/lib/supabase/server'
import InactivityRedirect from './components/InactivityRedirect'
import LastViewedBanner from './components/LastViewedBanner'
import ScrollToOpenUnit from './components/ScrollToOpenUnit'
import AdminLogout from './components/AdminLogout'
import DeleteUnitButton from './components/DeleteUnitButton'
import NotesForm from './components/NotesForm'
import CheckInForm from './components/CheckInForm'
import { UnitPhoto } from './components/UnitPhoto'
import { UnitPhotoGallery } from './components/UnitPhotoGallery'
import UnitPhotoUpload from './components/UnitPhotoUpload'
import UppercaseInput from './components/UppercaseInput'
import ContactLinksBar from './components/ContactLinksBar'
import SiteFooter from './components/SiteFooter'
import { resolveUnitParts } from '@/lib/parts'
import { sendEmail } from '@/lib/email'
import { createAdminClient } from '@/lib/supabase/admin'
import CreateCustomerLoginForm from './components/CreateCustomerLoginForm'
import DeleteCustomerLoginForm from './components/DeleteCustomerLoginForm'
import CreateCustomInvoiceForm from './components/CreateCustomInvoiceForm'
import UnitStatusFields from './components/UnitStatusFields'
import DiagnosisMediaUpload from './components/DiagnosisMediaUpload'

function stampHistory(existing: string | null, entry: string) {
  const line = `${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} - ${entry}`
  return existing ? `${line}\n${existing}` : line
}

// Placeholder text customers/admin type when the real serial isn't known.
// Never used to match an existing fleet unit - several different physical
// units can share the same placeholder, so matching on it would silently
// merge unrelated equipment into one record.
const NON_IDENTIFYING_SERIALS = new Set(['unknown', 'n/a', 'na', 'none', 'unk', 'tbd', '-', '--', '?'])
function isIdentifyingSerial(value: string) {
  const normalized = value.trim().toLowerCase()
  return normalized.length > 0 && !NON_IDENTIFYING_SERIALS.has(normalized)
}
// ilike treats % and _ as wildcards - escape them so a serial containing
// either is matched literally instead of as a pattern.
function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, '\\$&')
}

async function addUnit(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const serial = formData.get('serial') as string
  const model = formData.get('model') as string
  const customerNotes = formData.get('customer_notes') as string
  const customerId = formData.get('customer_id') as string
  const checkInDate = formData.get('check_in_date') as string
  const photoUrl = (formData.get('photo_url') as string) || null
  const extraPhotoUrls = (formData.getAll('extra_photo_url') as string[]).filter(Boolean)
  const equipmentType = formData.get('equipment_type') as string
  const hourMeter = formData.get('hour_meter') as string
  const isPriority = formData.get('is_priority') === 'true'
  const expediteFeeRaw = formData.get('expedite_fee') as string
  const expediteFee = expediteFeeRaw ? Number(expediteFeeRaw) : null
  const trimmedSerial = serial.trim()
  const createdAt = checkInDate ? new Date(checkInDate).toISOString() : new Date().toISOString()
  const historyEntry = `Checked in${isPriority ? ' (PRIORITY)' : ''}`

  // A unit already on this customer's fleet (same serial) gets linked and
  // its status updated instead of creating a second, duplicate row.
  // Skipped for placeholder serials ("Unknown", "N/A", ...) since those
  // aren't unique to one physical unit.
  let existingUnit: { id: string; history: string | null } | null = null
  if (isIdentifyingSerial(trimmedSerial)) {
    const { data: existingMatches } = await supabase
      .from('units')
      .select('id, history')
      .eq('customer_id', customerId)
      .ilike('serial_number', escapeLikePattern(trimmedSerial))
      .order('created_at', { ascending: false })
      .limit(1)
    existingUnit = existingMatches?.[0] || null
  }

  const checkInFields = {
    serial_number: serial,
    model: model || null,
    notes: customerNotes || null,
    status: 'Diagnosing',
    decision_seen: true,
    equipment_type: equipmentType || null,
    hour_meter: hourMeter || null,
    is_priority: isPriority,
    expedite_fee: expediteFee,
    created_at: createdAt,
    status_since: createdAt,
  }

  let unitId = existingUnit?.id ?? null
  if (existingUnit) {
    await supabase
      .from('units')
      .update({
        ...checkInFields,
        ...(photoUrl ? { photo_url: photoUrl, thumbnail_url: photoUrl } : {}),
        archived: false,
        history: stampHistory(existingUnit.history, historyEntry),
      })
      .eq('id', existingUnit.id)
  } else {
    const { data: inserted } = await supabase
      .from('units')
      .insert({
        ...checkInFields,
        customer_id: customerId,
        photo_url: photoUrl,
        thumbnail_url: photoUrl,
        history: stampHistory(null, historyEntry),
      })
      .select('id')
      .single()
    unitId = inserted?.id ?? null
  }

  // Beyond the first (primary) check-in photo, any additional ones picked
  // in the same multi-select go into the check-in gallery (unit_photos),
  // same as photos added later via UnitPhotoUpload.
  if (unitId && extraPhotoUrls.length > 0) {
    await supabase.from('unit_photos').insert(extraPhotoUrls.map(url => ({ unit_id: unitId, url })))
  }

  revalidatePath('/')
}

async function addFleetUnit(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const serial = formData.get('serial') as string
  const model = formData.get('model') as string
  const customerId = formData.get('customer_id') as string
  const equipmentType = formData.get('equipment_type') as string
  const hourMeter = formData.get('hour_meter') as string
  const purchaseDate = formData.get('purchase_date') as string
  const lastServiceDate = formData.get('last_service_date') as string
  const warrantyEnd = formData.get('warranty_end') as string
  const fleetNotes = formData.get('fleet_notes') as string
  const partNumbers = formData.get('part_numbers') as string
  const nickname = formData.get('nickname') as string
  const trimmedSerial = serial.trim()

  // Same serial/customer dedup as check-in (addUnit) - a unit already
  // checked in for service (or already on the fleet) gets its fleet
  // details filled in on the existing record instead of a second,
  // duplicate row. Status is left untouched so this never pulls an
  // in-progress repair back to 'Fleet'. Skipped for placeholder serials
  // ("Unknown", "N/A", ...) since those aren't unique to one physical unit.
  let existingUnit: { id: string; history: string | null } | null = null
  if (isIdentifyingSerial(trimmedSerial)) {
    const { data: existingMatches } = await supabase
      .from('units')
      .select('id, history')
      .eq('customer_id', customerId)
      .ilike('serial_number', escapeLikePattern(trimmedSerial))
      .order('created_at', { ascending: false })
      .limit(1)
    existingUnit = existingMatches?.[0] || null
  }

  const fleetFields = {
    serial_number: serial,
    model: model || null,
    equipment_type: equipmentType || null,
    hour_meter: hourMeter || null,
    purchase_date: purchaseDate || null,
    last_service_date: lastServiceDate || null,
    warranty_end: warrantyEnd || null,
    fleet_notes: fleetNotes || null,
    part_numbers: partNumbers || null,
    nickname: nickname || null,
  }

  if (existingUnit) {
    await supabase
      .from('units')
      .update({
        ...fleetFields,
        archived: false,
        history: stampHistory(existingUnit.history, 'Added to fleet inventory'),
      })
      .eq('id', existingUnit.id)
  } else {
    await supabase.from('units').insert({
      ...fleetFields,
      customer_id: customerId,
      status: 'Fleet',
      decision_seen: true,
      history: stampHistory(null, 'Added to fleet inventory'),
    })
  }
  revalidatePath('/')
}

async function updateFleetUnit(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  const fleetNotes = formData.get('fleet_notes') as string
  const partNumbers = formData.get('part_numbers') as string
  const lastServiceDate = formData.get('last_service_date') as string
  const purchaseDate = formData.get('purchase_date') as string
  const warrantyEnd = formData.get('warranty_end') as string
  const hourMeter = formData.get('hour_meter') as string
  const nickname = formData.get('nickname') as string
  const serial = formData.get('serial') as string
  const shortblockReplaced = formData.get('shortblock_replaced') === 'true'

  const update: any = {
    fleet_notes: fleetNotes || null,
    part_numbers: partNumbers || null,
    last_service_date: lastServiceDate || null,
    purchase_date: purchaseDate || null,
    warranty_end: warrantyEnd || null,
    hour_meter: hourMeter || null,
    nickname: nickname || null,
    shortblock_replaced: shortblockReplaced,
  }
  // A shortblock swap doesn't come with a new serial - the unit keeps its
  // existing record and serial number, this just flags that it happened.
  if (serial?.trim()) update.serial_number = serial.trim()

  const { data: existing } = await supabase
    .from('units')
    .select('history, shortblock_replaced')
    .eq('id', id)
    .single()
  if (shortblockReplaced && !existing?.shortblock_replaced) {
    update.history = stampHistory(existing?.history, 'Shortblock replaced - serial number retained')
  }

  await supabase.from('units').update(update).eq('id', id)
  revalidatePath('/')
}

// Sets the email a customer logs into their portal with. link_customer_account
// (called from the customer portal on load) matches against this same
// column, so this is also what links a customer's portal account to their
// records.
async function updateCustomerEmail(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  const email = ((formData.get('email') as string) || '').trim()
  await supabase.from('customers').update({ email: email || null }).eq('id', id)
  revalidatePath('/')
}

type CreateLoginState = { success: boolean; message: string; password?: string } | null

function generateDefaultPassword() {
  return `Savage${Math.floor(1000 + Math.random() * 9000)}!`
}

// Admin-controlled account creation - creates the Supabase Auth user
// directly (via the service-role client, since the anon-key client can't
// call auth.admin.createUser) rather than the customer signing up
// themselves. link_customer_account (called from the customer portal on
// login) picks up the auth_user_id <-> customers link automatically once
// customers.email matches, same as the public signup flow.
async function createCustomerLogin(_prevState: CreateLoginState, formData: FormData): Promise<CreateLoginState> {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const email = ((formData.get('email') as string) || '').trim()
  const customerId = (formData.get('customer_id') as string) || ''
  const newCustomerName = ((formData.get('new_customer_name') as string) || '').trim()
  const passwordInput = ((formData.get('password') as string) || '').trim()

  if (!email) return { success: false, message: 'Email is required.' }
  if (!customerId && !newCustomerName) {
    return { success: false, message: 'Choose an existing customer or enter a name for a new one.' }
  }

  const adminClient = createAdminClient()
  if (!adminClient) {
    return { success: false, message: 'SUPABASE_SERVICE_ROLE_KEY is not configured yet - cannot create login accounts.' }
  }

  const password = passwordInput || generateDefaultPassword()
  const { error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createErr) {
    return { success: false, message: `Could not create account: ${createErr.message}` }
  }

  if (customerId) {
    await supabase.from('customers').update({ email }).eq('id', customerId)
  } else {
    await supabase.from('customers').insert({ name: newCustomerName, email })
  }

  revalidatePath('/')
  return {
    success: true,
    message: `Login created for ${email}.`,
    password: passwordInput ? undefined : password,
  }
}

type DeleteLoginState = { success: boolean; message: string } | null

// Companion to createCustomerLogin, for cleaning up test/dummy customers.
// Refuses to run while the customer still has units attached (delete those
// first - units.customer_id has no cascade, so this would otherwise fail
// with a foreign key error) rather than silently deleting someone's real
// service history along with the account. Removes the linked auth account
// through the proper Admin API - never a raw SQL delete on auth.users,
// which skips GoTrue's own cleanup of sessions/identities/refresh tokens.
async function deleteCustomerLogin(_prevState: DeleteLoginState, formData: FormData): Promise<DeleteLoginState> {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const customerId = (formData.get('customer_id') as string) || ''
  if (!customerId) return { success: false, message: 'Choose a customer.' }

  const { data: customer } = await supabase
    .from('customers')
    .select('id, name, auth_user_id')
    .eq('id', customerId)
    .single()
  if (!customer) return { success: false, message: 'Customer not found.' }

  const { count: unitCount } = await supabase
    .from('units')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customerId)
  if ((unitCount ?? 0) > 0) {
    return { success: false, message: `${customer.name} still has ${unitCount} unit(s) attached - remove those first.` }
  }

  if (customer.auth_user_id) {
    const adminClient = createAdminClient()
    if (!adminClient) {
      return { success: false, message: 'SUPABASE_SERVICE_ROLE_KEY is not configured yet - cannot remove the login account.' }
    }
    const { error: deleteAuthErr } = await adminClient.auth.admin.deleteUser(customer.auth_user_id)
    // A stale customers.auth_user_id pointing at an already-deleted auth
    // account isn't a real failure - nothing to clean up, so fall through
    // to removing the customer row same as if it had never been linked.
    const alreadyGone = deleteAuthErr && (
      (deleteAuthErr as { status?: number }).status === 404 ||
      /not.?found/i.test(deleteAuthErr.message)
    )
    if (deleteAuthErr && !alreadyGone) {
      return { success: false, message: `Could not remove login account: ${deleteAuthErr.message}` }
    }
  }

  const { data: deletedRows, error: deleteCustomerErr } = await supabase
    .from('customers')
    .delete()
    .eq('id', customerId)
    .select('id')
  if (deleteCustomerErr) {
    return { success: false, message: `Could not remove customer record: ${deleteCustomerErr.message}` }
  }
  if (!deletedRows || deletedRows.length === 0) {
    return { success: false, message: `${customer.name} was not removed - the delete affected no rows (likely a permissions issue).` }
  }
  revalidatePath('/')
  return { success: true, message: `${customer.name} removed, along with its login account if it had one.` }
}

async function scheduleFleetService(formData: FormData) {
  'use server'
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
    history: stampHistory(existing?.history, entry),
  }).eq('id', id)

  revalidatePath('/')
}

async function returnToFleet(formData: FormData) {
  'use server'
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

async function markPickedUp(formData: FormData) {
  'use server'
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

async function updateStatus(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  let status = formData.get('status') as string
  const notes = formData.get('notes') as string
  const diagnosisNotesRaw = formData.get('diagnosis_notes') as string
  const diagnosisNotes = diagnosisNotesRaw?.trim() || null
  const file = formData.get('invoice') as File
  const isPriority = formData.get('is_priority') === 'true'
  const expediteFeeRaw = formData.get('expedite_fee') as string
  const serviceCostRaw = formData.get('service_cost') as string
  const { data: existing } = await supabase.from('units').select('status, history, is_priority, problem_type, diagnosis_notes').eq('id', id).single()
  const wasAlreadyDone = existing ? existing.status === 'Ready for Pickup' : false

  // Diagnosis Notes (what was actually found wrong) must exist before a
  // unit leaves Diagnosing - a separate field from the customer's own
  // check-in notes, never overwriting it. Block the status change (keep
  // it where it is) rather than silently letting a unit through without
  // findings recorded; everything else on the form still saves.
  const requiresDiagnosisNotes = (status === 'Needs Approval' || status === 'In Repair') && !diagnosisNotes
  if (requiresDiagnosisNotes && existing) {
    status = existing.status
  }

  const updateData: any = {
    status,
    notes: notes || null,
    is_priority: isPriority,
  }
  if (diagnosisNotes && diagnosisNotes !== existing?.diagnosis_notes) {
    updateData.diagnosis_notes = diagnosisNotes
    updateData.diagnosis_notes_updated_at = new Date().toISOString()
  }
  if (expediteFeeRaw !== null && expediteFeeRaw !== undefined && expediteFeeRaw !== '') {
    updateData.expedite_fee = Number(expediteFeeRaw)
  }
  if (existing && existing.status !== status) {
    updateData.history = stampHistory(existing.history, `Status -> ${status}`)
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
      await supabase.from('service_history').insert({
        unit_id: id,
        description: notes || existing?.problem_type || 'Service completed',
        cost: serviceCostRaw ? Number(serviceCostRaw) : null,
      })
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
  revalidatePath('/')
}

async function markDecisionSeen(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  await supabase.from('units').update({ decision_seen: true }).eq('id', id)
  revalidatePath('/')
}

async function snoozeUnit(formData: FormData) {
  'use server'
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
async function nudgeUnit(formData: FormData) {
  'use server'
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

async function updateNotes(_prevState: { savedAt: number } | null, formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  const notes = formData.get('notes') as string
  await supabase.from('units').update({ notes: notes || null }).eq('id', id)
  revalidatePath('/')
  return { savedAt: Date.now() }
}

async function upsertUnitPartOverride(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = (formData.get('id') as string) || null
  const unitId = formData.get('unit_id') as string
  const unitModel = (formData.get('unit_model') as string) || null
  const partName = (formData.get('part_name') as string || '').trim()
  const sku = (formData.get('sku') as string || '').trim().toUpperCase()
  const skuType = (formData.get('sku_type') as string) === 'Aftermarket' ? 'Aftermarket' : 'OEM'
  if (!unitId || !partName || !sku) return

  if (id) {
    await supabase
      .from('unit_part_overrides')
      .update({ part_name: partName, sku, sku_type: skuType, updated_at: new Date().toISOString() })
      .eq('id', id)
  } else {
    await supabase
      .from('unit_part_overrides')
      .upsert(
        { unit_id: unitId, part_name: partName, sku, sku_type: skuType },
        { onConflict: 'unit_id,part_name_key' }
      )
  }

  // OEM SKUs become the shared default for every unit of the same model
  // (re-running this on every save, including edits, keeps the default in
  // sync). Aftermarket SKUs are unit-only and never touch model_parts.
  if (skuType === 'OEM' && unitModel) {
    await supabase
      .from('model_parts')
      .upsert(
        { model: unitModel, part_name: partName, sku, sku_type: 'OEM' },
        { onConflict: 'model_key,part_name_key' }
      )
  }
  revalidatePath('/')
  revalidatePath('/parts')
  revalidatePath('/reports')
}

async function deleteUnitPartOverride(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  await supabase.from('unit_part_overrides').delete().eq('id', id)
  revalidatePath('/')
}

async function addServiceHistoryEntry(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const unitId = formData.get('unit_id') as string
  const serviceDate = formData.get('service_date') as string
  const description = (formData.get('description') as string || '').trim()
  const costRaw = formData.get('cost') as string
  if (!unitId || !description) return
  await supabase.from('service_history').insert({
    unit_id: unitId,
    service_date: serviceDate || new Date().toISOString().split('T')[0],
    description,
    cost: costRaw ? Number(costRaw) : null,
  })
  revalidatePath('/')
}

async function deleteServiceHistoryEntry(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  await supabase.from('service_history').delete().eq('id', id)
  revalidatePath('/')
}

async function addUnitPhoto(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const unitId = formData.get('unit_id') as string
  const photoUrls = (formData.getAll('photo_url') as string[]).filter(Boolean)
  if (!unitId || photoUrls.length === 0) return
  await supabase.from('unit_photos').insert(photoUrls.map(url => ({ unit_id: unitId, url })))
  revalidatePath('/')
}

async function deleteUnitPhoto(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  await supabase.from('unit_photos').delete().eq('id', id)
  revalidatePath('/')
}

// Diagnosis Findings - photos/videos the admin captures while diagnosing a
// unit, kept in the same unit_photos table as the check-in gallery but
// tagged stage: 'diagnosis' so the two never mix. Takes every file from one
// multi-select upload in a single bulk insert, rather than one row at a
// time.
async function addDiagnosisMedia(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const unitId = formData.get('unit_id') as string
  const urls = formData.getAll('media_url') as string[]
  const types = formData.getAll('media_type') as string[]
  if (!unitId || urls.length === 0) return
  const rows = urls
    .map((url, i) => ({ unit_id: unitId, url, media_type: types[i] === 'video' ? 'video' : 'photo', stage: 'diagnosis' }))
    .filter(r => r.url)
  if (rows.length === 0) return
  await supabase.from('unit_photos').insert(rows)
  revalidatePath('/')
}

function getFleetColor(unit: any): 'red' | 'green' | 'orange' {
  const threeMonthsAgo = new Date()
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
  const lastService = unit.last_service_date ? new Date(unit.last_service_date) : null
  const purchase = unit.purchase_date ? new Date(unit.purchase_date) : null
  const reference = lastService || purchase
  if (unit.status === 'Ready for Pickup' || lastService) {
    if (reference && reference < threeMonthsAgo) return 'red'
    return 'green'
  }
  if (reference && reference < threeMonthsAgo) return 'red'
  return 'orange'
}

function equipmentGroup(type: string | null): number {
  if (!type) return 3
  const t = type.toLowerCase()
  if (t.includes('riding') || (t.includes('mower') && !t.includes('walk'))) return 1
  if (t.includes('chainsaw') || t.includes('pole') || t.includes('cutquik') || t.includes('hedge')) return 2
  return 3
}

function groupLabel(n: number) {
  if (n === 1) return 'Riding Mowers'
  if (n === 2) return 'Chainsaws / Handheld'
  return 'Trimmers & Misc'
}

// Model - Type first - never lead with serial
function unitLabel(unit: any) {
  const model = (unit.model || '').trim()
  const type = (unit.equipment_type || '').trim()
  if (model && type) return `${model} - ${type}`
  if (model) return model
  if (type) return type
  return unit.nickname || unit.serial_number || 'No model'
}

function isUnderWarranty(unit: any): boolean {
  if (!unit.warranty_end) return false
  const today = new Date().toISOString().slice(0, 10)
  return unit.warranty_end >= today
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string; status?: string; open?: string }>
}) {
  const { supabase, user, isAdmin } = await getSessionInfo()
  if (!user || !isAdmin) redirect('/login')

  const params = await searchParams
  const selectedCustomerId = params.customer || null
  const statusFilter = params.status || null
  const openUnitId = params.open || null

  const { data: customers } = await supabase.from('customers').select('*').order('name')
  const { data: allUnits } = await supabase.from('units').select('*').order('created_at', { ascending: false })
  const { data: modelPartsAll } = await supabase.from('model_parts').select('*')
  const { data: unitOverridesAll } = await supabase.from('unit_part_overrides').select('*')
  const { data: serviceHistoryAll } = await supabase
    .from('service_history')
    .select('*')
    .order('service_date', { ascending: false })
    .order('created_at', { ascending: false })
  const { data: unitPhotosAll } = await supabase
    .from('unit_photos')
    .select('*')
    .order('created_at', { ascending: true })
  const { data: unitMessagesAll } = await supabase
    .from('messages')
    .select('*')
    .not('unit_id', 'is', null)
    .order('created_at', { ascending: true })

  let units = allUnits
  if (selectedCustomerId && !statusFilter) {
    units = allUnits?.filter(u => u.customer_id === selectedCustomerId) || []
  }

  const received = allUnits?.filter(u => u.status === 'Received').length || 0
  const diagnosing = allUnits?.filter(u => u.status === 'Diagnosing').length || 0
  const needsApproval = allUnits?.filter(u => u.status === 'Needs Approval').length || 0
  const inRepair = allUnits?.filter(u => u.status === 'In Repair').length || 0
  const repairRequested = allUnits?.filter(u => u.status === 'Repair Requested').length || 0
  const readyPickup = allUnits?.filter(u => u.status === 'Ready for Pickup').length || 0
  const priorityCount = allUnits?.filter(u => u.is_priority).length || 0

  const fleetUnitsAll = (selectedCustomerId
    ? allUnits?.filter(u => u.customer_id === selectedCustomerId)
    : allUnits) || []
  const unitsCount = fleetUnitsAll.length

  const statusFilteredUnits = (() => {
    if (!statusFilter || !allUnits) return []
    let list = allUnits
    if (selectedCustomerId) {
      list = list.filter(u => u.customer_id === selectedCustomerId)
    }
    if (statusFilter === 'Priority') return list.filter(u => u.is_priority)
    if (statusFilter === 'Units') return list
    return list.filter(u => u.status === statusFilter)
  })()

  const currentCustomer = customers?.find(c => c.id === selectedCustomerId)
  const now = new Date()
  const isSnoozed = (u: any) => u.snoozed_until && new Date(u.snoozed_until) > now

  // "Stale" = sitting in the current status for 7+ days without a status
  // change (status_since), not just time since original check-in - a unit
  // that moved through several statuses quickly but is now stuck doesn't
  // get penalized for its overall age, and one that's been stuck since day
  // one looks the same either way.
  type StaleCheck = { status_since?: string | null; created_at: string; snoozed_until?: string | null }
  const daysInStatus = (u: StaleCheck) =>
    Math.floor((now.getTime() - new Date(u.status_since || u.created_at).getTime()) / (1000 * 60 * 60 * 24))
  const isStaleInStatus = (u: StaleCheck) => !isSnoozed(u) && daysInStatus(u) >= 7
  // Stable sort - stale units bump to the top, but keep their existing
  // (newest-check-in-first) relative order within each group.
  const sortStaleFirst = <T extends StaleCheck>(list: T[]) =>
    [...list].sort((a, b) => Number(isStaleInStatus(b)) - Number(isStaleInStatus(a)))

  const staleUnits = (units?.filter(u => {
    if (isSnoozed(u)) return false
    if (['Registered', 'Ready for Pickup', 'Fleet'].includes(u.status)) return false
    return daysInStatus(u) >= 7
  }) || []).map(u => ({
    ...u,
    daysSinceCheckIn: daysInStatus(u),
  }))

  const approvedDecisions = units?.filter(u => !u.decision_seen && u.notes?.includes('Approved by')) || []
  const deniedDecisions = units?.filter(u => !u.decision_seen && u.notes?.includes('Denied by')) || []
  const waitingOnCustomer = sortStaleFirst(units?.filter(u => u.status === 'Needs Approval' && !isSnoozed(u)) || [])
  const repairRequestedUnits = sortStaleFirst(units?.filter(u => u.status === 'Repair Requested' && !isSnoozed(u)) || [])
  const diagnosingUnits = sortStaleFirst(units?.filter(u => u.status === 'Diagnosing' && !isSnoozed(u)) || [])
  const readyForPickupUnits = sortStaleFirst(units?.filter(u => u.status === 'Ready for Pickup' && !isSnoozed(u)) || [])
  const priorityUnits = sortStaleFirst(units?.filter(u => u.is_priority && !isSnoozed(u)) || [])

  const customerFleet = selectedCustomerId
    ? (allUnits?.filter(u => u.customer_id === selectedCustomerId) || [])
    : []
  const sortedFleet = [...customerFleet].sort((a, b) => {
    const ga = equipmentGroup(a.equipment_type)
    const gb = equipmentGroup(b.equipment_type)
    if (ga !== gb) return ga - gb
    return (a.serial_number || '').localeCompare(b.serial_number || '')
  })

  const repairUnits = sortStaleFirst(units?.filter(u => u.status !== 'Fleet') || [])

  function formatDate(dateString: string | null) {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  }
  function formatShortDate(dateString: string | null) {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  }

  function ActionCard({ unit, borderColor, children }: { unit: any; borderColor: string; children?: React.ReactNode }) {
    return (
      <div className={`px-4 sm:px-6 py-3 hover:bg-zinc-800/40 transition border-l-4 ${borderColor}`}>
        <div className="flex items-start gap-3">
          <Link href={`/?customer=${unit.customer_id}&open=${unit.id}`} className="flex gap-3 sm:gap-4 flex-1 min-w-0">
            <UnitPhoto unit={unit} size="h-14 w-14 sm:h-24 sm:w-24" emptyContent="No photo" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-base sm:text-xl font-semibold truncate">{unitLabel(unit)}</p>
                {unit.is_priority && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-orange-500 text-black">PRIORITY</span>
                )}
                {isStaleInStatus(unit) && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-red-600 text-white">
                    NEEDS ATTENTION - {daysInStatus(unit)}d
                  </span>
                )}
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                  unit.status === 'Needs Approval' || unit.status === 'Repair Requested' ? 'bg-yellow-500/20 text-yellow-400'
                    : unit.status === 'Ready for Pickup' ? 'bg-green-500/20 text-green-400'
                    : unit.status === 'In Repair' ? 'bg-blue-500/20 text-blue-400'
                    : unit.status === 'Fleet' ? 'bg-zinc-600 text-gray-300'
                    : 'bg-orange-500/20 text-orange-400'
                }`}>{unit.status}</span>
              </div>
              <p className="text-sm text-gray-400">
                Serial: {unit.serial_number || '-'}
                {unit.nickname ? ` - ${unit.nickname}` : ''}
              </p>
              {children}
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500 mt-0.5">
                <span>Checked in: {formatDate(unit.created_at)}</span>
                {unit.hour_meter && <span>Hours: {unit.hour_meter}</span>}
              </div>
              <p className="text-xs text-orange-400 mt-2">Tap card to open unit {'->'}</p>
            </div>
          </Link>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <form action={snoozeUnit}>
              <input type="hidden" name="id" value={unit.id} />
              <input type="hidden" name="days" value="7" />
              <button type="submit" className="bg-zinc-700 hover:bg-zinc-600 text-white text-sm px-3 py-1.5 rounded-lg transition whitespace-nowrap">Delay 7 Days</button>
            </form>
            {(approvedDecisions.some(d => d.id === unit.id) || deniedDecisions.some(d => d.id === unit.id)) && (
              <form action={markDecisionSeen}>
                <input type="hidden" name="id" value={unit.id} />
                <button type="submit" className="bg-zinc-600 hover:bg-zinc-500 text-white text-sm px-3 py-1.5 rounded-lg transition whitespace-nowrap">Mark Seen</button>
              </form>
            )}
            <DeleteUnitButton id={unit.id} />
          </div>
        </div>
        <details className="mt-2 group/notes ml-[calc(3.5rem+0.75rem)] sm:ml-[calc(6rem+1rem)]">
          <summary className="text-xs text-orange-400 hover:text-orange-300 cursor-pointer list-none select-none">
            Notes {unit.notes ? '- has notes' : ''}
          </summary>
          <NotesForm unitId={unit.id} initialNotes={unit.notes || ''} action={updateNotes} />
        </details>
      </div>
    )
  }

  function UnitPartsSection({ unit }: { unit: any }) {
    const parts = resolveUnitParts(unit, modelPartsAll || [], unitOverridesAll || [])
    return (
      <details className="mt-3 border-t border-zinc-800 pt-2.5 group/parts-panel">
        <summary className="flex items-center justify-between cursor-pointer list-none select-none mb-2">
          <span className="text-xs text-gray-500 uppercase tracking-wider">
            Parts &amp; SKUs (admin only){parts.length > 0 ? ` (${parts.length})` : ''}
          </span>
          <span className="text-gray-500 text-xs group-open/parts-panel:rotate-180 transition">v</span>
        </summary>
        {parts.length === 0 ? (
          <div className="mb-2 space-y-1.5">
            <p className="text-xs text-gray-500">No default parts set for this model yet.</p>
            <Link href="/parts" className="inline-block text-xs bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded-lg">
              Add one in the Parts Catalog
            </Link>
          </div>
        ) : (
          <div className="space-y-1.5 mb-2">
            {parts.map(p => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-gray-300 w-28 shrink-0">{p.part_name}</span>
                <span className="font-mono text-orange-300">{p.sku}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  p.sku_type === 'Aftermarket' ? 'bg-purple-500/20 text-purple-400' : 'bg-zinc-700 text-gray-300'
                }`}>
                  {p.sku_type}
                </span>
                {p.isOverride ? (
                  <>
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-500/20 text-blue-400">
                      {p.hasDefault ? 'Overridden' : 'Unit-only'}
                    </span>
                    <form action={deleteUnitPartOverride}>
                      <input type="hidden" name="id" value={p.id} />
                      <button type="submit" className="text-xs text-red-400 hover:text-red-300">
                        {p.hasDefault ? 'Reset to default' : 'Remove'}
                      </button>
                    </form>
                  </>
                ) : (
                  <span className="text-xs text-gray-600">Model default</span>
                )}
              </div>
            ))}
          </div>
        )}
        <details className="group/parts">
          <summary className="inline-flex w-fit text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-orange-400 px-3 py-1.5 rounded-lg cursor-pointer list-none select-none">
            Override or add a part for this unit
          </summary>
          <form action={upsertUnitPartOverride} className="mt-2 flex flex-wrap gap-2">
            <input type="hidden" name="unit_id" value={unit.id} />
            <input type="hidden" name="unit_model" value={unit.model || ''} />
            <input
              name="part_name"
              list={`parts-${unit.id}`}
              placeholder="Part name (e.g. Blade)"
              className="flex-1 min-w-[140px] bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
            />
            <datalist id={`parts-${unit.id}`}>
              {parts.map(p => <option key={p.id} value={p.part_name} />)}
            </datalist>
            <UppercaseInput
              name="sku"
              placeholder="SKU"
              className="flex-1 min-w-[140px] font-mono bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
            />
            <select
              name="sku_type"
              defaultValue="OEM"
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
            >
              <option value="OEM">OEM (sets default for this model)</option>
              <option value="Aftermarket">Aftermarket (this unit only)</option>
            </select>
            <button type="submit" className="text-xs bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded-lg">
              Save
            </button>
          </form>
        </details>
      </details>
    )
  }

  function UnitPhotosSection({ unit }: { unit: any }) {
    const extraPhotos = (unitPhotosAll || []).filter(p => p.unit_id === unit.id && p.stage === 'checkin')
    const photos = [
      ...(unit.photo_url ? [{ id: 'checkin', url: unit.photo_url as string, caption: 'Check-in photo', deletable: false }] : []),
      ...extraPhotos.map(p => ({ id: p.id as string, url: p.url as string, caption: p.caption as string | null })),
    ]
    return (
      <details className="mt-3 border-t border-zinc-800 pt-2.5 group/photos-panel">
        <summary className="flex items-center justify-between cursor-pointer list-none select-none mb-2">
          <span className="text-xs text-gray-500 uppercase tracking-wider">
            Photos{photos.length > 0 ? ` (${photos.length})` : ''}
          </span>
          <span className="text-gray-500 text-xs group-open/photos-panel:rotate-180 transition">v</span>
        </summary>
        <div className="space-y-2">
          {photos.length === 0 ? (
            <p className="text-xs text-gray-500">No photos yet.</p>
          ) : (
            <UnitPhotoGallery photos={photos} onDelete={deleteUnitPhoto} />
          )}
          <UnitPhotoUpload unitId={unit.id} action={addUnitPhoto} />
        </div>
      </details>
    )
  }

  // Diagnosis Findings - a section deliberately separate from Photos above:
  // its own heading, own upload control (multi-select, photos and videos),
  // own storage tag (stage: 'diagnosis'). Never mixes with the check-in
  // gallery. Visible to the customer too (see the matching block in
  // app/customer/page.tsx), right alongside Diagnosis Notes.
  function DiagnosisFindingsSection({ unit }: { unit: { id: string } }) {
    const media = (unitPhotosAll || []).filter(p => p.unit_id === unit.id && p.stage === 'diagnosis')
    return (
      <details className="mt-3 group/diagnosis-media-panel" open={media.length > 0}>
        {/* Deliberately loud - this used to be an easy-to-miss plain-text
            caption. A highlighted, bordered box makes it impossible to
            scroll past without noticing there's media attached. */}
        <summary className="flex items-center justify-between gap-2 cursor-pointer list-none select-none bg-orange-500/15 border border-orange-500/40 rounded-lg px-3 py-2.5 hover:bg-orange-500/20 transition">
          <span className="flex items-center gap-2 text-sm font-bold text-orange-300 uppercase tracking-wide">
            Diagnosis Findings - Photos &amp; Videos
            {media.length > 0 && (
              <span className="text-xs bg-orange-500 text-black font-bold rounded-full px-2 py-0.5">{media.length}</span>
            )}
          </span>
          <span className="text-orange-400 text-xs group-open/diagnosis-media-panel:rotate-180 transition">v</span>
        </summary>
        <div className="space-y-2 mt-2">
          {media.length === 0 ? (
            <p className="text-xs text-gray-500">No diagnosis photos/videos yet.</p>
          ) : (
            <UnitPhotoGallery
              photos={media.map(p => ({ id: p.id as string, url: p.url as string, caption: p.caption as string | null, mediaType: p.media_type as 'photo' | 'video' }))}
              onDelete={deleteUnitPhoto}
            />
          )}
          <DiagnosisMediaUpload unitId={unit.id} action={addDiagnosisMedia} />
        </div>
      </details>
    )
  }

  function ServiceHistorySection({ unit }: { unit: any }) {
    const entries = (serviceHistoryAll || []).filter(e => e.unit_id === unit.id)
    return (
      <details className="mt-3 border-t border-zinc-800 pt-2.5 group/history-panel">
        <summary className="flex items-center justify-between cursor-pointer list-none select-none mb-2">
          <span className="text-xs text-gray-500 uppercase tracking-wider">
            Service History{entries.length > 0 ? ` (${entries.length})` : ''}
          </span>
          <span className="text-gray-500 text-xs group-open/history-panel:rotate-180 transition">v</span>
        </summary>
        {entries.length === 0 ? (
          <p className="text-xs text-gray-500 mb-2">
            No service history yet. Entries are logged automatically when a unit is marked Ready for Pickup.
          </p>
        ) : (
          <div className="space-y-1.5 mb-2">
            {entries.map(e => (
              <div key={e.id} className="flex flex-wrap items-start gap-2 text-sm">
                <span className="text-gray-500 w-24 shrink-0">{formatShortDate(e.service_date)}</span>
                <span className="text-gray-300 flex-1 min-w-[140px]">{e.description}</span>
                <span className="font-mono text-orange-300">{e.cost != null ? `$${Number(e.cost).toFixed(2)}` : '-'}</span>
                <form action={deleteServiceHistoryEntry}>
                  <input type="hidden" name="id" value={e.id} />
                  <button type="submit" className="text-xs text-red-400 hover:text-red-300">Remove</button>
                </form>
              </div>
            ))}
          </div>
        )}
        <details className="group/service-history">
          <summary className="inline-flex w-fit text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-orange-400 px-3 py-1.5 rounded-lg cursor-pointer list-none select-none">
            Add a service history entry
          </summary>
          <form action={addServiceHistoryEntry} className="mt-2 flex flex-wrap gap-2">
            <input type="hidden" name="unit_id" value={unit.id} />
            <input
              name="service_date"
              type="date"
              defaultValue={new Date().toISOString().split('T')[0]}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
            />
            <input
              name="description"
              placeholder="Work performed"
              className="flex-1 min-w-[140px] bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
            />
            <input
              name="cost"
              type="number"
              step="0.01"
              min="0"
              placeholder="Cost $"
              className="w-28 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
            />
            <button type="submit" className="text-xs bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded-lg">
              Save
            </button>
          </form>
        </details>
      </details>
    )
  }

  // Admin-only. Generates a PDF invoice on demand via /api/invoice - fee
  // amounts are entered fresh each time (not stored), since not every job
  // is billed the same. Service fee defaults to the unit's most recent
  // logged service cost as a starting point, left fully editable; parts
  // total has no price data to draw from (Parts & SKUs tracks name/SKU/
  // OEM-Aftermarket only, no pricing) so it's always blank/editable.
  function CreateInvoiceSection({ unit }: { unit: any }) {
    const parts = resolveUnitParts(unit, modelPartsAll || [], unitOverridesAll || [])
    const history = (serviceHistoryAll || []).filter(e => e.unit_id === unit.id)
    const latestCost = history[0]?.cost ?? ''
    return (
      <details className="mt-3 border-t border-zinc-800 pt-2.5 group/invoice-panel">
        <summary className="flex items-center justify-between cursor-pointer list-none select-none mb-2">
          <span className="text-xs text-gray-500 uppercase tracking-wider">Create Invoice</span>
          <span className="text-gray-500 text-xs group-open/invoice-panel:rotate-180 transition">v</span>
        </summary>
        <form action="/api/invoice" method="POST" target="_blank" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="unit_id" value={unit.id} />
          <div>
            <label className="block text-xs text-gray-500 mb-1">Labor / Service Fee $</label>
            <input
              name="service_fee"
              type="number"
              step="0.01"
              min="0"
              defaultValue={latestCost}
              placeholder="0.00"
              className="w-32 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Parts Total $</label>
            <input
              name="parts_total"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              className="w-32 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
            />
          </div>
          <button type="submit" className="bg-orange-600 hover:bg-orange-500 text-white text-sm px-4 py-1.5 rounded-lg">
            Create Invoice
          </button>
        </form>
        <p className="text-xs text-gray-600 mt-1.5">
          {parts.length > 0
            ? `${parts.length} part${parts.length === 1 ? '' : 's'} on file will be listed on the invoice.`
            : 'No parts on file for this unit - the invoice will still generate.'}
        </p>
      </details>
    )
  }

  // Read-only view of a customer's written replies about this unit (the
  // messages table, scoped by unit_id - reused rather than a new table).
  // Not a back-and-forth chat, just a way for the admin to see a question
  // or concern the customer left about the diagnosis/quote.
  type UnitReply = { id: string; customer_name: string | null; created_at: string; message: string }
  function UnitReplies({ messages }: { messages: UnitReply[] }) {
    if (messages.length === 0) return null
    return (
      <div className="mt-3 border-t border-zinc-800 pt-2.5">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Customer Replies</p>
        <div className="space-y-2">
          {messages.map(m => (
            <div key={m.id} className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-2">
              <p className="text-xs text-gray-500">
                {m.customer_name || 'Customer'} - {new Date(m.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </p>
              <p className="text-sm text-gray-200 whitespace-pre-wrap mt-0.5">{m.message}</p>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // The full editable unit panel - status dropdown, priority/fee/cost,
  // notes, invoice upload, withdraw/pickup, nudge, history, photos, parts,
  // service history. Shared between the per-customer "All Units - Repair
  // Flow" list and the cross-customer status-queue view (clicking a status
  // stat tile) so an edit made from either place hits the same
  // updateStatus/etc. server actions against the same row - single source
  // of truth, no separate copy. accordionName scopes the native exclusive-
  // accordion group (via <details name>) so expanding one unit in a list
  // auto-collapses the others in that same list without affecting the
  // other list.
  function UnitDetailPanel({ unit, accordionName }: { unit: any; accordionName: string }) {
    return (
      <details
        name={accordionName}
        className="group/item border-2 border-transparent open:border-orange-500 open:bg-zinc-800/30 open:rounded-lg open:my-1 transition-colors"
        open={openUnitId === unit.id}
        id={`unit-${unit.id}`}
      >
        <summary className="px-4 sm:px-6 py-2.5 cursor-pointer hover:bg-zinc-800/50 transition flex items-center gap-3">
          <UnitPhoto unit={unit} size="h-12 w-12" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium truncate">{unitLabel(unit)}</p>
              {unit.is_priority && <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-orange-500 text-black">PRIORITY</span>}
              {isStaleInStatus(unit) && (
                <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-red-600 text-white">
                  NEEDS ATTENTION - {daysInStatus(unit)}d
                </span>
              )}
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                unit.status === 'Needs Approval' || unit.status === 'Repair Requested' ? 'bg-yellow-500/20 text-yellow-400'
                  : unit.status === 'Ready for Pickup' ? 'bg-green-500/20 text-green-400'
                  : unit.status === 'In Repair' ? 'bg-blue-500/20 text-blue-400'
                  : 'bg-orange-500/20 text-orange-400'
              }`}>{unit.status}</span>
            </div>
            <p className="text-xs text-gray-500">
              Serial: {unit.serial_number || '-'}
              {unit.nickname ? ` - ${unit.nickname}` : ''}
            </p>
          </div>
        </summary>
        <div className="px-4 sm:px-6 pb-4">
          {/* Everything to do with diagnosing this unit - the status/notes
              form (Diagnosis Notes included), Parts & SKUs, the quote/
              estimate tool, and Diagnosis Findings media - grouped into one
              bordered block instead of scattered across the panel. Mirrors
              the customer-facing grouping in app/customer/page.tsx. */}
          <div className="border border-orange-500/30 rounded-xl p-3 sm:p-4 bg-orange-500/[0.03] space-y-3">
            <form action={updateStatus} className="space-y-3">
              <input type="hidden" name="id" value={unit.id} />
              <div className="flex flex-wrap items-center gap-3">
                <UnitStatusFields unit={unit} key={unit.id + unit.status + unit.diagnosis_notes} />
                <label className="flex items-center gap-1.5 text-xs text-orange-400 cursor-pointer">
                  <input type="checkbox" name="is_priority" value="true" defaultChecked={!!unit.is_priority} className="rounded border-zinc-600 bg-zinc-800 text-orange-500" />
                  Priority
                </label>
                <input name="expedite_fee" type="number" step="0.01" min="0" defaultValue={unit.expedite_fee ?? ''} placeholder="Fee $" className="w-24 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm" />
                <input name="service_cost" type="number" step="0.01" min="0" placeholder="Cost charged $" title="If this update marks the unit Ready for Pickup, this amount is logged to Service History" className="w-32 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm" />
                <button type="submit" className="bg-orange-600 hover:bg-orange-500 text-white text-sm px-4 py-1.5 rounded-lg">Update</button>
                <DeleteUnitButton id={unit.id} />
              </div>
              {unit.problem_type && (
                <p className="text-xs text-gray-400">
                  <span className="text-gray-500">Problem reported: </span>{unit.problem_type}
                </p>
              )}
              {(unit.status === 'Needs Approval' || unit.status === 'Ready for Pickup') && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{unit.status === 'Needs Approval' ? 'Upload Invoice / Photo' : 'Upload Photo'}</label>
                  <input type="file" name="invoice" accept="image/*,.pdf" className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-orange-600 file:text-white" />
                </div>
              )}
              {unit.invoice_url && (
                <a href={unit.invoice_url} target="_blank" rel="noreferrer" className="text-xs text-orange-400 hover:text-orange-300">View current invoice/quote {'->'}</a>
              )}
            </form>

            <DiagnosisFindingsSection unit={unit} />
            <UnitPartsSection unit={unit} />
            <CreateInvoiceSection unit={unit} />
          </div>

          <UnitReplies messages={unitMessagesAll?.filter(m => m.unit_id === unit.id) || []} />

          <form action={nudgeUnit} className="pt-3">
            <input type="hidden" name="id" value={unit.id} />
            <button type="submit" className="bg-purple-600 hover:bg-purple-500 text-white text-sm px-4 py-1.5 rounded-lg" title="Emails the customer a quick reminder about this unit">
              Nudge Customer
            </button>
          </form>

          {(unit.status === 'Repair Requested' || unit.status === 'Received' || unit.status === 'Diagnosing' || unit.status === 'Registered') && (
            <form action={returnToFleet} className="pt-3">
              <input type="hidden" name="id" value={unit.id} />
              <button type="submit" className="bg-zinc-700 hover:bg-zinc-600 text-white text-sm px-4 py-1.5 rounded-lg">
                Withdraw {'->'} Return to Fleet
              </button>
            </form>
          )}

          {unit.status === 'Ready for Pickup' && (
            <details className="pt-3 group/pickup">
              <summary className="text-sm text-green-400 hover:text-green-300 cursor-pointer list-none select-none font-medium">
                Mark as Picked Up
              </summary>
              <form action={markPickedUp} className="mt-2 flex flex-wrap gap-2">
                <input type="hidden" name="id" value={unit.id} />
                <input
                  name="picked_up_by"
                  required
                  placeholder="Name of person picking up"
                  className="flex-1 min-w-[180px] bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
                />
                <button type="submit" className="bg-green-600 hover:bg-green-500 text-white text-sm px-4 py-1.5 rounded-lg">
                  Confirm Picked Up
                </button>
              </form>
              <CreateInvoiceSection unit={unit} />
            </details>
          )}

          {unit.picked_up_by && (
            <p className="text-xs text-gray-500 pt-3">
              Picked up by <span className="text-gray-300">{unit.picked_up_by}</span> on {formatDate(unit.picked_up_at)}
            </p>
          )}

          {unit.history && (
            <div className="mt-3 border-t border-zinc-800 pt-2.5">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">History</p>
              <pre className="text-xs text-gray-400 whitespace-pre-wrap font-sans leading-relaxed">{unit.history}</pre>
            </div>
          )}

          <UnitPhotosSection unit={unit} />
          <ServiceHistorySection unit={unit} />
        </div>
      </details>
    )
  }

  function groupUnitsByCustomer(unitList: any[]) {
    const groups = new Map<string, { customer: any; units: any[] }>()
    for (const unit of unitList) {
      const key = unit.customer_id || 'unknown'
      if (!groups.has(key)) {
        groups.set(key, { customer: customers?.find(c => c.id === unit.customer_id) || null, units: [] })
      }
      groups.get(key)!.units.push(unit)
    }
    return Array.from(groups.values()).sort((a, b) => {
      if (b.units.length !== a.units.length) return b.units.length - a.units.length
      return (a.customer?.name || 'Unknown').localeCompare(b.customer?.name || 'Unknown')
    })
  }

  function CustomerGroupHeader({ customer, count }: { customer: any; count: number }) {
    return (
      <div className="flex items-center gap-3 px-4 sm:px-6 py-2 bg-zinc-800 border-b border-zinc-700">
        {customer?.logo_url ? (
          <img
            src={customer.logo_url}
            alt={customer.name}
            className="h-9 w-9 rounded-lg object-contain bg-zinc-900 border border-zinc-700 shrink-0"
          />
        ) : null}
        <h3 className="text-lg sm:text-xl font-bold text-white truncate">{customer?.name || 'Unknown Customer'}</h3>
        <span className="text-xs text-gray-400 shrink-0 ml-auto">{count} unit{count !== 1 ? 's' : ''}</span>
      </div>
    )
  }

  function GroupedActionList({
    units: list,
    borderColor,
    renderExtra,
  }: {
    units: any[]
    borderColor: string
    renderExtra?: (unit: any) => React.ReactNode
  }) {
    return (
      <>
        {groupUnitsByCustomer(list).map((group, i) => (
          <div key={group.customer?.id || 'unknown'} className={i > 0 ? 'border-t-4 border-zinc-950' : ''}>
            <CustomerGroupHeader customer={group.customer} count={group.units.length} />
            <div className="divide-y divide-zinc-800/60">
              {group.units.map(unit => (
                <ActionCard key={unit.id} unit={unit} borderColor={borderColor}>
                  {renderExtra?.(unit)}
                </ActionCard>
              ))}
            </div>
          </div>
        ))}
      </>
    )
  }

  let lastGroup = 0

  const tiles = [
    { key: 'Repair Requested', label: 'Requested', count: repairRequested, color: 'text-blue-300' },
    { key: 'Received', label: 'Received', count: received, color: 'text-purple-400' },
    { key: 'Diagnosing', label: 'Diagnosing', count: diagnosing, color: 'text-orange-400' },
    { key: 'Needs Approval', label: 'Needs Approval', count: needsApproval, color: 'text-yellow-400' },
    { key: 'In Repair', label: 'In Repair', count: inRepair, color: 'text-blue-400' },
    { key: 'Ready for Pickup', label: 'Ready', count: readyPickup, color: 'text-green-300' },
    { key: 'Priority', label: 'Priority', count: priorityCount, color: 'text-orange-500' },
    { key: 'Units', label: 'All Units', count: unitsCount, color: 'text-orange-300' },
  ]

  return (
    <main className="min-h-screen bg-zinc-950 text-white p-4 sm:p-6 md:p-10">
      <Suspense fallback={null}><InactivityRedirect /></Suspense>
      <ScrollToOpenUnit unitId={openUnitId} />

      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4 md:mb-6 bg-zinc-900 border border-zinc-800 rounded-xl p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <img src="/images/logo.png" alt="Savage Chainsaws" className="h-12 w-12 md:h-14 md:w-14 object-contain" />
            <div>
              <h1 className="text-xl md:text-3xl font-bold tracking-tight">
                SAVAGE <span className="text-orange-500">CHAINSAWS</span>
              </h1>
              <p className="text-gray-400 text-sm">Unit Tracking Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <form className="flex items-center gap-2 sm:gap-3">
              <select name="customer" defaultValue={selectedCustomerId || ''} className="bg-zinc-900 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 max-w-[200px] sm:max-w-none">
                <option value="">All Customers (Action Center)</option>
                {customers?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button type="submit" className="bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition">Switch</button>
            </form>
            <Link
              href="/reports"
              className="border border-zinc-600 hover:border-orange-500 text-xs px-3 py-1.5 rounded-lg"
            >
              Reports
            </Link>
            <Link
              href="/inventory"
              className="border border-zinc-600 hover:border-orange-500 text-xs px-3 py-1.5 rounded-lg"
            >
              Inventory
            </Link>
            <Link
              href="/parts"
              className="border border-zinc-600 hover:border-orange-500 text-xs px-3 py-1.5 rounded-lg"
            >
              Parts
            </Link>
            <ContactLinksBar />
            <AdminLogout />
          </div>
        </div>

        <Suspense fallback={null}><LastViewedBanner customers={customers || []} /></Suspense>

        {currentCustomer && (
          <div className="mb-3">
            <p className="text-xl font-semibold text-orange-400">{currentCustomer.name}</p>
            <p className="text-sm text-gray-400">Total Units: <span className="text-white font-medium">{units?.length || 0}</span></p>
            <form action={updateCustomerEmail} className="flex flex-wrap items-center gap-2 mt-2">
              <input type="hidden" name="id" value={currentCustomer.id} />
              <label className="text-xs text-gray-500">Portal login email:</label>
              <input
                name="email"
                type="email"
                defaultValue={currentCustomer.email || ''}
                placeholder="customer@example.com"
                className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm w-64"
              />
              <button type="submit" className="bg-orange-600 hover:bg-orange-500 text-white text-sm px-4 py-1.5 rounded-lg">Save</button>
            </form>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-2 mb-4 md:mb-6">
          {tiles.map(tile => {
            const href = selectedCustomerId
              ? `/?customer=${selectedCustomerId}&status=${encodeURIComponent(tile.key)}`
              : `/?status=${encodeURIComponent(tile.key)}`
            const active = statusFilter === tile.key
            return (
              <Link
                key={tile.key}
                href={href}
                className={`bg-zinc-900 border rounded-lg px-3 py-1.5 md:py-2 transition hover:border-orange-500/60 flex flex-col items-center justify-center gap-0.5 ${
                  active ? 'border-orange-500' : 'border-zinc-800'
                }`}
              >
                <p className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wider text-center leading-tight">
                  {tile.label}
                </p>
                <p className={`text-xl md:text-2xl font-bold ${tile.color} text-center leading-none`}>{tile.count}</p>
              </Link>
            )
          })}
        </div>

        {statusFilter && (
          <div className="bg-zinc-900 border border-orange-400/40 rounded-xl overflow-hidden mb-5">
            <div className="px-4 sm:px-6 py-3 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-orange-300">
                  {statusFilter === 'Units' ? 'All Units' : statusFilter} ({statusFilteredUnits.length})
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">Click a unit below to expand and update it directly</p>
              </div>
              <Link
                href={selectedCustomerId ? `/?customer=${selectedCustomerId}` : '/'}
                className="text-sm text-gray-400 hover:text-white border border-zinc-700 rounded-lg px-4 py-2 transition"
              >
                {'<-'} Back to {selectedCustomerId ? 'customer' : 'Action Center'}
              </Link>
            </div>
            {statusFilteredUnits.length === 0 ? (
              <p className="px-4 sm:px-6 py-5 text-gray-500 text-sm">No units found.</p>
            ) : (
              <div className="divide-y divide-zinc-800">
                {groupUnitsByCustomer(statusFilteredUnits).map((group, i) => (
                  <div key={group.customer?.id || 'unknown'} className={i > 0 ? 'border-t-4 border-zinc-950' : ''}>
                    <CustomerGroupHeader customer={group.customer} count={group.units.length} />
                    <div className="divide-y divide-zinc-800/60">
                      {group.units.map(unit => (
                        <UnitDetailPanel key={unit.id} unit={unit} accordionName="status-queue-unit" />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!selectedCustomerId && !statusFilter && (
          <>
            {priorityUnits.length > 0 && (
              <div className="bg-zinc-900 border border-orange-500/50 rounded-xl overflow-hidden mb-5">
                <div className="px-4 sm:px-6 py-3 border-b border-zinc-800"><h2 className="text-lg font-semibold text-orange-400">Priority Units ({priorityUnits.length})</h2></div>
                <div className="divide-y divide-zinc-800">
                  <GroupedActionList
                    units={priorityUnits}
                    borderColor="border-orange-500"
                    renderExtra={unit => (
                      <p className="text-sm text-orange-300">{unit.expedite_fee ? `Expedite fee: $${Number(unit.expedite_fee).toFixed(2)}` : 'Priority flag set'}</p>
                    )}
                  />
                </div>
              </div>
            )}
            {readyForPickupUnits.length > 0 && (
              <div className="bg-zinc-900 border border-green-500/40 rounded-xl overflow-hidden mb-5">
                <div className="px-4 sm:px-6 py-3 border-b border-zinc-800"><h2 className="text-lg font-semibold text-green-300">Ready for Pickup ({readyForPickupUnits.length})</h2></div>
                <div className="divide-y divide-zinc-800">
                  <GroupedActionList
                    units={readyForPickupUnits}
                    borderColor="border-green-400"
                    renderExtra={unit => (
                      <p className="text-sm text-green-300">{unit.notes || 'Ready for customer pickup'}</p>
                    )}
                  />
                </div>
              </div>
            )}
            {repairRequestedUnits.length > 0 && (
              <div className="bg-zinc-900 border border-blue-500/30 rounded-xl overflow-hidden mb-5">
                <div className="px-4 sm:px-6 py-3 border-b border-zinc-800"><h2 className="text-lg font-semibold text-blue-300">Repair Requested ({repairRequestedUnits.length})</h2></div>
                <div className="divide-y divide-zinc-800">
                  <GroupedActionList
                    units={repairRequestedUnits}
                    borderColor="border-blue-400"
                    renderExtra={unit => (
                      <p className="text-sm text-blue-300">{unit.notes || unit.problem_type || 'Customer requested repair'}</p>
                    )}
                  />
                </div>
              </div>
            )}
            {diagnosingUnits.length > 0 && (
              <div className="bg-zinc-900 border border-orange-500/30 rounded-xl overflow-hidden mb-5">
                <div className="px-4 sm:px-6 py-3 border-b border-zinc-800"><h2 className="text-lg font-semibold text-orange-400">Diagnosing ({diagnosingUnits.length})</h2></div>
                <div className="divide-y divide-zinc-800">
                  <GroupedActionList
                    units={diagnosingUnits}
                    borderColor="border-orange-500"
                    renderExtra={unit => (
                      <p className="text-sm text-orange-300">{unit.problem_type || unit.notes || 'In diagnosis'}</p>
                    )}
                  />
                </div>
              </div>
            )}
            {staleUnits.length > 0 && (
              <div className="bg-zinc-900 border border-red-500/30 rounded-xl overflow-hidden mb-5">
                <div className="px-4 sm:px-6 py-3 border-b border-zinc-800 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-red-400">Stagnant Units ({staleUnits.length})</h2>
                  <p className="text-xs text-red-300/80">Over 7 days with no action</p>
                </div>
                <div className="divide-y divide-zinc-800">
                  <GroupedActionList
                    units={staleUnits}
                    borderColor="border-red-500"
                    renderExtra={unit => (
                      <p className="text-sm text-red-400 font-medium">No action for {unit.daysSinceCheckIn} days</p>
                    )}
                  />
                </div>
              </div>
            )}
            {approvedDecisions.length > 0 && (
              <div className="bg-zinc-900 border border-green-500/30 rounded-xl overflow-hidden mb-5">
                <div className="px-4 sm:px-6 py-3 border-b border-zinc-800"><h2 className="text-lg font-semibold text-green-400">Customer Approved ({approvedDecisions.length})</h2></div>
                <div className="divide-y divide-zinc-800">
                  <GroupedActionList
                    units={approvedDecisions}
                    borderColor="border-green-500"
                    renderExtra={unit => (
                      <p className="text-sm text-green-300 font-medium">{unit.notes}</p>
                    )}
                  />
                </div>
              </div>
            )}
            {deniedDecisions.length > 0 && (
              <div className="bg-zinc-900 border border-red-500/30 rounded-xl overflow-hidden mb-5">
                <div className="px-4 sm:px-6 py-3 border-b border-zinc-800"><h2 className="text-lg font-semibold text-red-400">Customer Denied ({deniedDecisions.length})</h2></div>
                <div className="divide-y divide-zinc-800">
                  <GroupedActionList
                    units={deniedDecisions}
                    borderColor="border-red-500"
                    renderExtra={unit => (
                      <p className="text-sm text-red-300 font-medium">{unit.notes}</p>
                    )}
                  />
                </div>
              </div>
            )}
            <div className="bg-zinc-900 border border-yellow-500/30 rounded-xl overflow-hidden mb-5">
              <div className="px-4 sm:px-6 py-3 border-b border-zinc-800"><h2 className="text-lg font-semibold text-yellow-400">Waiting on Customer ({waitingOnCustomer.length})</h2></div>
              {waitingOnCustomer.length === 0 ? (
                <p className="px-4 sm:px-6 py-5 text-gray-500 text-sm">No units currently waiting on customer approval.</p>
              ) : (
                <div className="divide-y divide-zinc-800">
                  <GroupedActionList
                    units={waitingOnCustomer}
                    borderColor="border-yellow-500"
                    renderExtra={() => (
                      <p className="text-sm text-yellow-300">Waiting for customer decision</p>
                    )}
                  />
                </div>
              )}
            </div>
          </>
        )}

        {selectedCustomerId && !statusFilter && (
          <>
            <details
              className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-4 group"
              open={!!openUnitId && repairUnits.some(u => u.id === openUnitId)}
            >
              <summary className="px-4 sm:px-6 py-3 cursor-pointer list-none flex items-center justify-between hover:bg-zinc-800/40 transition">
                <h2 className="font-semibold text-orange-400">All Units - Repair Flow ({repairUnits.length})</h2>
                <span className="text-gray-500 text-sm group-open:rotate-180 transition">v</span>
              </summary>
              <div className="border-t border-zinc-800 divide-y divide-zinc-800">
                {repairUnits.length === 0 && (
                  <p className="px-4 sm:px-6 py-5 text-gray-500 text-sm">No active repair units.</p>
                )}
                {repairUnits.map(unit => (
                  <UnitDetailPanel key={unit.id} unit={unit} accordionName="repair-unit" />
                ))}
              </div>
            </details>

            <details className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-4 group">
              <summary className="px-4 sm:px-6 py-3 cursor-pointer list-none flex items-center justify-between hover:bg-zinc-800/40 transition">
                <h2 className="font-semibold text-orange-400">Check In New Unit</h2>
                <span className="text-gray-500 text-sm group-open:rotate-180 transition">v</span>
              </summary>
              <div className="border-t border-zinc-800 p-4 sm:p-6">
                <CheckInForm customerId={selectedCustomerId} addUnitAction={addUnit} />
              </div>
            </details>

            <details className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-4 group">
              <summary className="px-4 sm:px-6 py-3 cursor-pointer list-none flex items-center justify-between hover:bg-zinc-800/40 transition">
                <div className="flex items-center gap-3">
                  <h2 className="font-semibold text-orange-300">Fleet Units ({sortedFleet.length})</h2>
                  <span className="text-xs text-gray-500 hidden sm:inline inline-flex items-center gap-3">
                    <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-green-500" />Serviced</span>
                    <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-orange-500" />Known</span>
                    <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-red-500" />Due</span>
                  </span>
                </div>
                <span className="text-gray-500 text-sm group-open:rotate-180 transition">v</span>
              </summary>
              <div className="border-t border-zinc-800">
                <details className="border-b border-zinc-800">
                  <summary className="px-4 sm:px-6 py-3 cursor-pointer list-none flex items-center gap-2 text-sm text-orange-400 hover:text-orange-300 hover:bg-zinc-800/30 transition">
                    <span className="text-lg leading-none">+</span>
                    <span className="font-medium">Add Unit to Fleet</span>
                  </summary>
                  <form action={addFleetUnit} className="px-4 sm:px-6 pb-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <input type="hidden" name="customer_id" value={selectedCustomerId} />
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Model</label>
                      <input name="model" placeholder="e.g. RZ 752" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Serial Number *</label>
                      <input name="serial" required className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                      <p className="text-xs text-gray-600 mt-1">
                        Illegible plate? Use a custom ID instead (e.g. BR800CE-1) - tracked the same as a real serial.
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Nickname (optional)</label>
                      <input name="nickname" placeholder="e.g. T1" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Equipment Type</label>
                      <select name="equipment_type" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm">
                        <option>Riding Mower</option>
                        <option>Walk-Behind Mower</option>
                        <option>Chainsaw</option>
                        <option>Pole Saw</option>
                        <option>String Trimmer</option>
                        <option>Hedge Trimmer</option>
                        <option>Blower</option>
                        <option>Backpack Blower</option>
                        <option>Edger</option>
                        <option>Cutquik</option>
                        <option>Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Purchase Date</label>
                      <input type="date" name="purchase_date" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Last Service Date</label>
                      <input type="date" name="last_service_date" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Warranty End Date</label>
                      <input type="date" name="warranty_end" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Hour Meter</label>
                      <input name="hour_meter" placeholder="e.g. 12.5" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">Part Numbers</label>
                      <input name="part_numbers" placeholder="Parts needed..." className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <label className="block text-xs text-gray-500 mb-1">Fleet Notes</label>
                      <textarea name="fleet_notes" rows={2} placeholder="Anything about this unit..." className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <button type="submit" className="bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-5 py-2 rounded-lg">Add to Fleet</button>
                    </div>
                  </form>
                </details>

                {sortedFleet.length === 0 ? (
                  <p className="px-4 sm:px-6 py-5 text-gray-500 text-sm">No fleet units yet. Use + Add Unit to Fleet above.</p>
                ) : (
                  <div className="divide-y divide-zinc-800">
                    {sortedFleet.map(unit => {
                      const g = equipmentGroup(unit.equipment_type)
                      const showHeader = g !== lastGroup
                      if (showHeader) lastGroup = g
                      const color = getFleetColor(unit)
                      return (
                        <div key={unit.id}>
                          {showHeader && (
                            <div className="px-4 sm:px-6 py-2 bg-zinc-800/50">
                              <p className="text-xs uppercase tracking-wider text-gray-400 font-medium">{groupLabel(g)}</p>
                            </div>
                          )}
                          <details className="group/fleet">
                            <summary className="px-4 sm:px-6 py-3 cursor-pointer hover:bg-zinc-800/40 transition flex items-center justify-between gap-2">
                              <div className="flex items-center gap-3 min-w-0">
                                <span className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${color === 'red' ? 'bg-red-500' : color === 'green' ? 'bg-green-500' : 'bg-orange-500'}`} />
                                <UnitPhoto unit={unit} size="h-10 w-10" />
                                <div className="min-w-0">
                                  <p className="font-medium truncate">{unitLabel(unit)}</p>
                                  <p className="text-xs text-gray-500 truncate">
                                    Serial: {unit.serial_number || '-'}
                                    {unit.nickname ? ` - ${unit.nickname}` : ''}
                                    {unit.hour_meter ? ` - ${unit.hour_meter} hrs` : ''}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {isUnderWarranty(unit) && (
                                  <span className="text-xs px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-400">Under Warranty</span>
                                )}
                                {unit.shortblock_replaced && (
                                  <span className="text-xs px-2.5 py-1 rounded-full bg-purple-500/20 text-purple-400">Shortblock Replaced</span>
                                )}
                                <span className={`text-xs px-2.5 py-1 rounded-full ${
                                  unit.status === 'Fleet' ? 'bg-zinc-700 text-gray-300'
                                    : unit.status === 'Ready for Pickup' ? 'bg-green-500/20 text-green-400'
                                    : 'bg-orange-500/20 text-orange-400'
                                }`}>{unit.status}</span>
                              </div>
                            </summary>
                            <div className="px-4 sm:px-6 pb-4 space-y-3">
                              <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                                <span>Purchased: {formatShortDate(unit.purchase_date)}</span>
                                <span>Last service: {formatShortDate(unit.last_service_date)}</span>
                                <span>Warranty end: {formatShortDate(unit.warranty_end)}</span>
                              </div>
                              {unit.picked_up_by && (
                                <p className="text-xs text-gray-500">
                                  Picked up by <span className="text-gray-300">{unit.picked_up_by}</span> on {formatDate(unit.picked_up_at)}
                                </p>
                              )}
                              <form action={updateFleetUnit} className="space-y-3">
                                <input type="hidden" name="id" value={unit.id} />
                                <div className="grid sm:grid-cols-2 gap-3">
                                  <div>
                                    <label className="block text-xs text-gray-500 mb-1">Nickname</label>
                                    <input name="nickname" defaultValue={unit.nickname || ''} placeholder="e.g. T1" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                                  </div>
                                  <div>
                                    <label className="block text-xs text-gray-500 mb-1">Serial Number</label>
                                    <input name="serial" defaultValue={unit.serial_number || ''} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                                    <p className="text-xs text-gray-600 mt-1">
                                      Illegible plate? Use a custom ID instead (e.g. BR800CE-1) - tracked the same as a real serial.
                                    </p>
                                  </div>
                                  <div>
                                    <label className="block text-xs text-gray-500 mb-1">Purchase Date</label>
                                    <input type="date" name="purchase_date" defaultValue={unit.purchase_date || ''} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                                  </div>
                                  <div>
                                    <label className="block text-xs text-gray-500 mb-1">Last Service Date</label>
                                    <input type="date" name="last_service_date" defaultValue={unit.last_service_date || ''} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                                  </div>
                                  <div>
                                    <label className="block text-xs text-gray-500 mb-1">Warranty End Date</label>
                                    <input type="date" name="warranty_end" defaultValue={unit.warranty_end || ''} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                                  </div>
                                  <div>
                                    <label className="block text-xs text-gray-500 mb-1">Hour Meter</label>
                                    <input name="hour_meter" defaultValue={unit.hour_meter || ''} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                                  </div>
                                  <div>
                                    <label className="block text-xs text-gray-500 mb-1">Part Numbers</label>
                                    <input name="part_numbers" defaultValue={unit.part_numbers || ''} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                                  </div>
                                </div>
                                <div>
                                  <label className="block text-xs text-gray-500 mb-1">Fleet Notes</label>
                                  <textarea name="fleet_notes" rows={2} defaultValue={unit.fleet_notes || ''} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                                </div>
                                <label className="flex items-start gap-2 text-sm text-gray-300 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    name="shortblock_replaced"
                                    value="true"
                                    defaultChecked={!!unit.shortblock_replaced}
                                    className="mt-0.5 rounded border-zinc-600 bg-zinc-800 text-orange-500 focus:ring-orange-500"
                                  />
                                  <span>
                                    <span className="text-orange-400 font-medium">Shortblock Replacement</span>
                                    <span className="block text-xs text-gray-500">
                                      Engine shortblock was swapped on this unit - keeps this same record and serial number rather than starting a new one.
                                    </span>
                                  </span>
                                </label>
                                <div className="flex gap-2">
                                  <button type="submit" className="bg-orange-600 hover:bg-orange-500 text-white text-sm px-4 py-1.5 rounded-lg">Save</button>
                                  <DeleteUnitButton id={unit.id} />
                                </div>
                              </form>

                              <UnitPhotosSection unit={unit} />
                              <UnitPartsSection unit={unit} />
                              <ServiceHistorySection unit={unit} />
                              <CreateInvoiceSection unit={unit} />

                              {unit.status === 'Fleet' && (
                                <form action={scheduleFleetService} className="border-t border-zinc-800 pt-3 space-y-2">
                                  <input type="hidden" name="id" value={unit.id} />
                                  <label className="block text-xs text-gray-500">Schedule service / send to shop</label>
                                  <input
                                    name="service_note"
                                    placeholder="e.g. 3-month tune-up, won't start..."
                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                                  />
                                  <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-1.5 rounded-lg">
                                    Send to Repair Flow
                                  </button>
                                </form>
                              )}
                            </div>
                          </details>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </details>
          </>
        )}

        <details className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-4 group">
          <summary className="px-4 sm:px-6 py-3 cursor-pointer list-none flex items-center justify-between hover:bg-zinc-800/40 transition">
            <h2 className="font-semibold text-orange-400">Create Invoice</h2>
            <span className="text-gray-500 text-sm group-open:rotate-180 transition">v</span>
          </summary>
          <div className="border-t border-zinc-800 p-4 sm:p-6">
            <p className="text-xs text-gray-500 mb-3">
              Build a standalone itemized invoice on the spot - not tied to a tracked unit. Link an existing customer to auto-fill their info, or skip that and type everything from scratch.
            </p>
            <CreateCustomInvoiceForm
              customers={(customers || []).map(c => ({ id: c.id, name: c.name, email: c.email, phone: c.phone }))}
            />
          </div>
        </details>

        <details className="bg-zinc-900 border border-red-900/40 rounded-xl overflow-hidden mb-4 group">
          <summary className="px-4 sm:px-6 py-3 cursor-pointer list-none flex items-center justify-between hover:bg-zinc-800/40 transition">
            <h2 className="font-semibold text-red-400">Delete Customer / Login</h2>
            <span className="text-gray-500 text-sm group-open:rotate-180 transition">v</span>
          </summary>
          <div className="border-t border-zinc-800 p-4 sm:p-6">
            <p className="text-xs text-gray-500 mb-3">
              Permanently removes a customer record and its login account (if any), via the proper Supabase Auth admin API. Refuses to run while the customer still has units attached - remove those first.
            </p>
            <DeleteCustomerLoginForm
              customers={(customers || []).map(c => ({ id: c.id, name: c.name }))}
              action={deleteCustomerLogin}
            />
          </div>
        </details>

        <details className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-4 group">
          <summary className="px-4 sm:px-6 py-3 cursor-pointer list-none flex items-center justify-between hover:bg-zinc-800/40 transition">
            <h2 className="font-semibold text-orange-400">Create Customer Login</h2>
            <span className="text-gray-500 text-sm group-open:rotate-180 transition">v</span>
          </summary>
          <div className="border-t border-zinc-800 p-4 sm:p-6">
            <p className="text-xs text-gray-500 mb-3">
              Creates the login for a customer directly (invite-only, not public signup). Links to an existing customer or creates a new one.
            </p>
            <CreateCustomerLoginForm
              customers={(customers || []).map(c => ({ id: c.id, name: c.name }))}
              action={createCustomerLogin}
            />
          </div>
        </details>

        <SiteFooter />
      </div>
    </main>
  )
}

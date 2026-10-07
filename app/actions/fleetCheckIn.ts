'use server'

import { revalidatePath } from 'next/cache'
import { getSessionInfo } from '@/lib/supabase/server'
import { toTitleCase } from '@/lib/text'
import { sendPushToReferralSource } from '@/lib/push'
import { stampHistory, isIdentifyingSerial, escapeLikePattern } from '@/lib/units'
import { resolveReferralCode } from '@/lib/referrals'

export async function addUnit(formData: FormData) {
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
    notes_updated_at: new Date().toISOString(),
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

  // Referral code at check-in - only ever attaches a referral a customer
  // doesn't already have (never overwrites one already on file), so a
  // repeat visit typing a different/blank code can't silently reassign an
  // existing referral relationship or its first-service discount eligibility.
  const referralSourceId = await resolveReferralCode(supabase, formData)
  if (referralSourceId) {
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('name, referral_source_id')
      .eq('id', customerId)
      .maybeSingle()
    if (existingCustomer && !existingCustomer.referral_source_id) {
      await supabase.from('customers').update({ referral_source_id: referralSourceId }).eq('id', customerId)
      await sendPushToReferralSource(referralSourceId, {
        title: 'New referral signed up!',
        body: `${existingCustomer.name} just checked in using your referral code.`,
        url: '/referrer',
        tag: 'referral-signup',
      })
    }
  }

  revalidatePath('/')
}

export async function addFleetUnit(formData: FormData) {
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
  const nicknameRaw = ((formData.get('nickname') as string) || '').trim()
  const nickname = nicknameRaw ? toTitleCase(nicknameRaw) : ''
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

export async function updateFleetUnit(formData: FormData) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  const fleetNotes = formData.get('fleet_notes') as string
  const partNumbers = formData.get('part_numbers') as string
  const lastServiceDate = formData.get('last_service_date') as string
  const purchaseDate = formData.get('purchase_date') as string
  const warrantyEnd = formData.get('warranty_end') as string
  const hourMeter = formData.get('hour_meter') as string
  const nicknameRaw = ((formData.get('nickname') as string) || '').trim()
  const nickname = nicknameRaw ? toTitleCase(nicknameRaw) : ''
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

// Lets an admin correct a unit's identity fields after check-in, from the
// unit detail/action screen (not the separate Fleet management form above,
// which is updateFleetUnit) - the true model or serial is sometimes only
// discoverable after teardown, e.g. a unit checked in as an FS56 turns out
// to be an FC56, or a serial only becomes legible once the engine block is
// exposed. Writes straight to the same units row the customer portal
// reads, so there's nothing separate to keep in sync.
export async function updateUnitIdentity(formData: FormData) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  const model = ((formData.get('model') as string) || '').trim()
  const equipmentType = ((formData.get('equipment_type') as string) || '').trim()
  const serialNumber = ((formData.get('serial_number') as string) || '').trim()

  await supabase
    .from('units')
    .update({
      model: model || null,
      equipment_type: equipmentType || null,
      serial_number: serialNumber,
    })
    .eq('id', id)
  revalidatePath('/')
}

// Warranty is a separate, always-visible Yes/No toggle next to the Serial
// box (not gated behind the identity pencil control above), so it gets its
// own action - this way it never has to carry, and risk overwriting,
// model/equipment_type/serial_number just to flip a warranty flag.
export async function updateUnitWarranty(formData: FormData) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')
  const id = formData.get('id') as string
  const warrantyEnd = (formData.get('warranty_end') as string) || ''

  await supabase.from('units').update({ warranty_end: warrantyEnd || null }).eq('id', id)
  revalidatePath('/')
}

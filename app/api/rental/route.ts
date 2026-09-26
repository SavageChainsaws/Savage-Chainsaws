import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getSessionInfo } from '@/lib/supabase/server'
import { renderRentalAgreementPdf } from '@/lib/rentalAgreementPdf'
import { computeRentalDays, computeRentalCharge, type RentalType } from '@/lib/rentals'
import { toTitleCase, normalizeEmail } from '@/lib/text'
import { sendPushToCustomer } from '@/lib/push'
import { unitLabel } from '@/lib/units'

// Admin-only. Creates a rental against a tracked rental_units row (never a
// free-typed unit - see CreateRentalForm) so two rentals can never point at
// the same physical saw, generates the signed-ready agreement PDF (Pre-
// Rental Condition section filled in, Post-Rental left blank), and marks
// the unit Rented. The Square payment link for the pickup charge (rental +
// deposit) is generated on demand afterward from the rentals list, not
// automatically here - same on-demand philosophy as invoices.
//
// Takes a JSON body (not FormData) - condition photos are uploaded
// client-side beforehand (see RentalPhotoUpload) and their URLs travel in
// the body as a plain string array, same as every other field.
export async function POST(request: NextRequest) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const body = await request.json()
  const unitId = (body.unitId as string) || ''
  const customerId = ((body.customerId as string) || '').trim() || null
  const renterName = toTitleCase(((body.renterName as string) || '').trim())
  const renterCompany = toTitleCase(((body.renterCompany as string) || '').trim()) || null
  const renterPhone = ((body.renterPhone as string) || '').trim() || null
  const renterEmailRaw = ((body.renterEmail as string) || '').trim()
  const renterEmail = renterEmailRaw ? normalizeEmail(renterEmailRaw) : null
  const driverLicense = ((body.driverLicense as string) || '').trim().toUpperCase() || null
  const rentalTypeRaw = (body.rentalType as string) || 'daily'
  const rentalType: RentalType = rentalTypeRaw === 'weekly' ? 'weekly' : 'daily'
  const startDate = (body.startDate as string) || ''
  const endDate = (body.endDate as string) || ''
  const preExistingDamageNotes = ((body.preExistingDamageNotes as string) || '').trim() || null
  const prePhotoUrls: string[] = Array.isArray(body.prePhotoUrls) ? body.prePhotoUrls.filter(Boolean) : []

  if (!unitId || !renterName || !startDate || !endDate) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }
  if (new Date(endDate) < new Date(startDate)) {
    return NextResponse.json({ error: 'End date must be on or after the start date.' }, { status: 400 })
  }

  const { data: rentalUnit } = await supabase
    .from('rental_units')
    .select('*')
    .eq('id', unitId)
    .single()
  if (!rentalUnit) {
    return NextResponse.json({ error: 'Rental unit not found.' }, { status: 404 })
  }
  if (rentalUnit.status !== 'Available') {
    return NextResponse.json({ error: `This unit isn't available (status: ${rentalUnit.status}).` }, { status: 409 })
  }

  // A customer with a portal login signs the agreement themselves in the
  // app before it's finalized - a walk-in (no customer linked, or a
  // customer who's never had portal access set up) has no app to sign in,
  // so they keep the original flow: Active immediately with a
  // blank-signature-line PDF for a physical/on-the-spot signature.
  let hasPortalAccount = false
  if (customerId) {
    const { data: linkedCustomer } = await supabase.from('customers').select('auth_user_id').eq('id', customerId).maybeSingle()
    hasPortalAccount = !!linkedCustomer?.auth_user_id
  }

  // Daily rate × day count, or weekly rate × week count (partial weeks
  // round up) - see lib/rentals.ts computeRentalCharge. Day count is
  // inclusive of both start and end dates (Monday to Friday is 5 days).
  const days = computeRentalDays(startDate, endDate)
  const rentalCharge = computeRentalCharge(rentalType, Number(rentalUnit.daily_rate), Number(rentalUnit.weekly_rate), days)
  const securityDeposit = Number(rentalUnit.security_deposit)
  const damageCapAmount = Number(rentalUnit.damage_cap)
  const totalOwed = Math.round((rentalCharge + securityDeposit) * 100) / 100
  const now = new Date()

  const { data: rentalRow, error: insertError } = await supabase
    .from('rentals')
    .insert({
      unit_id: unitId,
      customer_id: customerId,
      renter_name: renterName,
      renter_company: renterCompany,
      renter_phone: renterPhone,
      renter_email: renterEmail,
      driver_license: driverLicense,
      rental_type: rentalType,
      rate_amount: rentalType === 'weekly' ? Number(rentalUnit.weekly_rate) : Number(rentalUnit.daily_rate),
      security_deposit: securityDeposit,
      damage_cap_amount: damageCapAmount,
      start_date: startDate,
      end_date: endDate,
      status: hasPortalAccount ? 'Pending Signature' : 'Active',
      pre_existing_damage_notes: preExistingDamageNotes,
      pre_rental_photo_urls: prePhotoUrls,
      rental_charge: rentalCharge,
      total_owed: totalOwed,
    })
    .select('*')
    .single()
  if (insertError || !rentalRow) {
    return NextResponse.json({ error: insertError?.message || 'Could not create the rental. Please try again.' }, { status: 500 })
  }

  // Reserved the moment it's assigned either way, so two rentals can never
  // point at the same physical saw while a signature is pending.
  await supabase.from('rental_units').update({ status: 'Rented' }).eq('id', unitId)

  if (hasPortalAccount) {
    await sendPushToCustomer(customerId!, {
      title: 'Rental agreement ready to sign',
      body: `${unitLabel(rentalUnit)} - review and sign in the app to continue.`,
      url: '/customer',
      tag: `rental-${rentalRow.id}`,
    })
    revalidatePath('/rentals')
    revalidatePath('/')
    return NextResponse.json({ rental: { ...rentalRow, agreement_pdf_url: null } })
  }

  const logoUrl = new URL('/images/logo.png', request.url).toString()
  const pdfBuffer = await renderRentalAgreementPdf({
    rentalReference: rentalRow.id.slice(0, 8).toUpperCase(),
    agreementDate: now.toISOString().slice(0, 10),
    unit: { model: rentalUnit.model, equipmentType: rentalUnit.equipment_type, serialNumber: rentalUnit.serial_number },
    renter: { name: renterName, company: renterCompany, phone: renterPhone, license: driverLicense },
    rentalType,
    rateAmount: rentalRow.rate_amount,
    startDate,
    endDate,
    securityDeposit,
    damageCap: damageCapAmount,
    preExistingDamageNotes,
    prePhotoUrls,
    postPhotoUrls: [],
    returnConditionNotes: null,
    fuelTankEmptyAtReturn: null,
    lateFeeAmount: 0,
    damageChargeAmount: 0,
    fuelChargeAmount: 0,
    rentalChargeTotal: rentalCharge,
    amountDue: totalOwed,
    returned: false,
    actualReturnDate: null,
    logoUrl,
  })

  let agreementPdfUrl: string | null = null
  try {
    const fileName = `${rentalRow.id}.pdf`
    const { error: uploadError } = await supabase.storage
      .from('rentals')
      .upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: true })
    if (!uploadError) {
      const { data: { publicUrl } } = supabase.storage.from('rentals').getPublicUrl(fileName)
      agreementPdfUrl = publicUrl
      await supabase.from('rentals').update({ agreement_pdf_url: publicUrl }).eq('id', rentalRow.id)
    }
  } catch (err) {
    console.error('Failed to save rental agreement PDF:', err)
  }

  revalidatePath('/rentals')
  revalidatePath('/')

  return NextResponse.json({ rental: { ...rentalRow, agreement_pdf_url: agreementPdfUrl } })
}

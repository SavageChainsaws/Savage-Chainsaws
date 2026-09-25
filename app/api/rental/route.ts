import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getSessionInfo } from '@/lib/supabase/server'
import { renderRentalAgreementPdf } from '@/lib/rentalAgreementPdf'
import { computeRentalDays, computeRentalCharge, type RentalType } from '@/lib/rentals'
import { toTitleCase } from '@/lib/text'

// Admin-only. Creates a rental against a tracked rental_units row (never a
// free-typed unit - see CreateRentalForm) so two rentals can never point at
// the same physical saw, generates the signed-ready agreement PDF (Pre-
// Rental Condition section filled in, Post-Rental left blank), and marks
// the unit Rented. The Square payment link for the pickup charge (rental +
// deposit) is generated on demand afterward from the rentals list, not
// automatically here - same on-demand philosophy as invoices.
export async function POST(request: NextRequest) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const formData = await request.formData()
  const rentalUnitId = (formData.get('rental_unit_id') as string) || ''
  const customerId = ((formData.get('customer_id') as string) || '').trim() || null
  const renterName = toTitleCase(((formData.get('renter_name') as string) || '').trim())
  const renterCompany = toTitleCase(((formData.get('renter_company') as string) || '').trim()) || null
  const renterPhone = ((formData.get('renter_phone') as string) || '').trim() || null
  const renterLicense = ((formData.get('renter_license') as string) || '').trim().toUpperCase() || null
  const rentalTypeRaw = (formData.get('rental_type') as string) || 'daily'
  const rentalType: RentalType = rentalTypeRaw === 'weekly' ? 'weekly' : 'daily'
  const startDate = (formData.get('start_date') as string) || ''
  const endDate = (formData.get('end_date') as string) || ''
  const preExistingDamageNotes = ((formData.get('pre_existing_damage_notes') as string) || '').trim() || null
  const prePhotoUrls = (formData.getAll('pre_photo_url') as string[]).filter(Boolean)

  if (!rentalUnitId || !renterName || !startDate || !endDate) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }
  if (new Date(endDate) < new Date(startDate)) {
    return NextResponse.json({ error: 'End date must be on or after the start date.' }, { status: 400 })
  }

  const { data: rentalUnit } = await supabase
    .from('rental_units')
    .select('*')
    .eq('id', rentalUnitId)
    .single()
  if (!rentalUnit) {
    return NextResponse.json({ error: 'Rental unit not found.' }, { status: 404 })
  }
  if (rentalUnit.status !== 'Available') {
    return NextResponse.json({ error: `This unit isn't available (status: ${rentalUnit.status}).` }, { status: 409 })
  }

  const rateAmount = rentalType === 'weekly' ? Number(rentalUnit.weekly_rate) : Number(rentalUnit.daily_rate)
  const days = computeRentalDays(startDate, endDate)
  const rentalChargeTotal = computeRentalCharge(rentalType, rateAmount, days)
  const securityDepositAmount = Number(rentalUnit.security_deposit)
  const damageCapAmount = Number(rentalUnit.damage_cap)
  const amountDue = Math.round((rentalChargeTotal + securityDepositAmount) * 100) / 100
  const now = new Date()

  const { data: rentalRow, error: insertError } = await supabase
    .from('rentals')
    .insert({
      rental_unit_id: rentalUnitId,
      customer_id: customerId,
      renter_name: renterName,
      renter_company: renterCompany,
      renter_phone: renterPhone,
      renter_license: renterLicense,
      rental_type: rentalType,
      rate_amount: rateAmount,
      security_deposit_amount: securityDepositAmount,
      damage_cap_amount: damageCapAmount,
      start_date: startDate,
      end_date: endDate,
      status: 'Active',
      pre_existing_damage_notes: preExistingDamageNotes,
      pre_rental_photo_urls: prePhotoUrls,
      rental_charge_total: rentalChargeTotal,
      amount_due: amountDue,
    })
    .select('id')
    .single()
  if (insertError || !rentalRow) {
    return NextResponse.json({ error: 'Could not create the rental. Please try again.' }, { status: 500 })
  }

  await supabase.from('rental_units').update({ status: 'Rented' }).eq('id', rentalUnitId)

  const logoUrl = new URL('/images/logo.png', request.url).toString()
  const pdfBuffer = await renderRentalAgreementPdf({
    rentalReference: rentalRow.id.slice(0, 8).toUpperCase(),
    agreementDate: now.toISOString().slice(0, 10),
    unit: { model: rentalUnit.model, equipmentType: rentalUnit.equipment_type, serialNumber: rentalUnit.serial_number },
    renter: { name: renterName, company: renterCompany, phone: renterPhone, license: renterLicense },
    rentalType,
    rateAmount,
    startDate,
    endDate,
    securityDeposit: securityDepositAmount,
    damageCap: damageCapAmount,
    preExistingDamageNotes,
    prePhotoUrls,
    postPhotoUrls: [],
    returnConditionNotes: null,
    fuelTankEmptyAtReturn: null,
    lateFeeAmount: 0,
    damageChargeAmount: 0,
    fuelChargeAmount: 0,
    rentalChargeTotal,
    amountDue,
    returned: false,
    actualReturnDate: null,
    logoUrl,
  })

  try {
    const fileName = `${rentalRow.id}.pdf`
    const { error: uploadError } = await supabase.storage
      .from('rentals')
      .upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: true })
    if (!uploadError) {
      const { data: { publicUrl } } = supabase.storage.from('rentals').getPublicUrl(fileName)
      await supabase.from('rentals').update({ agreement_pdf_url: publicUrl }).eq('id', rentalRow.id)
    }
  } catch (err) {
    console.error('Failed to save rental agreement PDF:', err)
  }

  revalidatePath('/rentals')
  revalidatePath('/')

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="rental-agreement-${rentalRow.id.slice(0, 8)}.pdf"`,
    },
  })
}

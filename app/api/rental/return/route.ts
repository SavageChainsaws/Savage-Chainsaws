import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getSessionInfo } from '@/lib/supabase/server'
import { renderRentalAgreementPdf } from '@/lib/rentalAgreementPdf'
import { computeLateFee, capDamageCharge } from '@/lib/rentals'

// Admin-only. Closes out a rental: computes the automatic $10/day late fee
// (Section 4), caps any damage charge at the rental's snapshotted liability
// cap (Section 2), and nets the security deposit already collected against
// the late/fuel/damage total - a new balance is only owed (and only then
// does a fresh Stripe payment link become available) if that total exceeds
// the deposit. Regenerates the same agreement PDF in place with the
// Post-Rental Condition section filled in, and returns the rental unit to
// the fleet (or Maintenance, if damage was found, so it isn't rented out
// again before Jesse looks at it).
//
// Takes a JSON body and returns the PDF's storage URL rather than the raw
// bytes - matches /api/rental (create) exactly, and for the same reason:
// a plain <form target="_blank"> POST has no real "new tab" to open inside
// an installed PWA (no browser chrome to hold one), so it was instead
// replacing the whole standalone app window with the PDF and leaving no
// way back. The caller opens its own tab with window.open() during the
// click's user-activation window, then points it at this response's URL
// once ready - see ReturnRentalForm.
export async function POST(request: NextRequest) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const body = await request.json()
  const rentalId = (body.rentalId as string) || ''
  const postPhotoUrls: string[] = Array.isArray(body.postPhotoUrls) ? body.postPhotoUrls.filter(Boolean) : []
  const returnConditionNotes = ((body.returnConditionNotes as string) || '').trim() || null
  const fuelTankEmpty = !!body.fuelTankEmpty
  const fuelChargeRaw = Number(body.fuelChargeAmount) || 0
  const damageChargeRaw = Number(body.damageChargeAmount) || 0
  if (!rentalId) {
    return NextResponse.json({ error: 'Missing rentalId' }, { status: 400 })
  }

  const { data: rental } = await supabase.from('rentals').select('*').eq('id', rentalId).single()
  if (!rental) {
    return NextResponse.json({ error: 'Rental not found' }, { status: 404 })
  }
  if (rental.status === 'Returned') {
    return NextResponse.json({ error: 'This rental has already been returned.' }, { status: 409 })
  }

  const { data: rentalUnit } = await supabase
    .from('rental_units')
    .select('*')
    .eq('id', rental.unit_id)
    .single()
  if (!rentalUnit) {
    return NextResponse.json({ error: 'Rental unit not found' }, { status: 404 })
  }

  const now = new Date()
  const lateFeeAmount = computeLateFee(rental.end_date, now)
  const fuelChargeAmount = fuelTankEmpty ? 0 : Math.max(0, fuelChargeRaw)
  const damageChargeAmount = capDamageCharge(damageChargeRaw, Number(rental.damage_cap_amount))
  const extraCharges = Math.round((lateFeeAmount + fuelChargeAmount + damageChargeAmount) * 100) / 100

  // securityDeposit is the contractual amount (always shown as-agreed on
  // the printed agreement below), but it's only something to net charges
  // against if the pickup charge (rental fee + deposit, collected together
  // as a single link) was actually paid - if it wasn't, no deposit is in
  // hand to absorb anything, and the still-unpaid rental fee itself has to
  // be billed now, alongside any late/fuel/damage charges, rather than
  // silently dropped.
  const pickupWasPaid = !!rental.paid_at
  const securityDeposit = Number(rental.security_deposit)
  const depositAvailableToNet = pickupWasPaid ? securityDeposit : 0
  const unpaidRentalCharge = pickupWasPaid ? 0 : Number(rental.rental_charge)
  const newChargesTotal = Math.round((unpaidRentalCharge + extraCharges) * 100) / 100
  const balanceDue = Math.max(0, Math.round((newChargesTotal - depositAvailableToNet) * 100) / 100)
  const depositRefundDue = pickupWasPaid ? Math.max(0, Math.round((depositAvailableToNet - extraCharges) * 100) / 100) : 0

  // The pickup charge's payment fields are about to be reused for the
  // balance-due cycle (if any) - record what happened to it first so that
  // history isn't silently lost, since paid_at/square_*/stripe_* only ever
  // track "the current charge cycle", not a full payment history.
  const pickupSummary = `Pickup charge $${Number(rental.total_owed).toFixed(2)} - ${
    rental.paid_at ? `paid (${rental.paid_via || 'unknown'}) ${new Date(rental.paid_at).toLocaleDateString()}` : 'UNPAID'
  } as of return on ${now.toLocaleDateString()}.`
  const refundNote = depositRefundDue > 0 ? ` Deposit refund owed to renter: $${depositRefundDue.toFixed(2)}.` : ''
  const notes = [rental.notes, pickupSummary + refundNote].filter(Boolean).join('\n')

  const rentalUnitStatus = damageChargeAmount > 0 ? 'Maintenance' : 'Available'

  await supabase
    .from('rentals')
    .update({
      status: 'Returned',
      actual_return_date: now.toISOString(),
      post_rental_photo_urls: postPhotoUrls,
      return_condition_notes: returnConditionNotes,
      fuel_tank_empty_at_return: fuelTankEmpty,
      late_fee_amount: lateFeeAmount,
      damage_charge_amount: damageChargeAmount,
      fuel_charge_amount: fuelChargeAmount,
      total_owed: balanceDue,
      notes,
      ...(balanceDue > 0
        ? {
            square_payment_link_id: null,
            square_order_id: null,
            square_payment_link_url: null,
            stripe_checkout_session_id: null,
            stripe_payment_link_url: null,
            paid_at: null,
            paid_via: null,
          }
        : {}),
    })
    .eq('id', rentalId)

  await supabase.from('rental_units').update({ status: rentalUnitStatus }).eq('id', rental.unit_id)

  const logoUrl = new URL('/images/logo.png', request.url).toString()
  const pdfBuffer = await renderRentalAgreementPdf({
    rentalReference: rental.id.slice(0, 8).toUpperCase(),
    agreementDate: rental.created_at.slice(0, 10),
    unit: { model: rentalUnit.model, equipmentType: rentalUnit.equipment_type, serialNumber: rentalUnit.serial_number },
    renter: { name: rental.renter_name, company: rental.renter_company, phone: rental.renter_phone, license: rental.driver_license },
    rentalType: rental.rental_type,
    rateAmount: Number(rental.rate_amount),
    startDate: rental.start_date,
    endDate: rental.end_date,
    securityDeposit,
    damageCap: Number(rental.damage_cap_amount),
    preExistingDamageNotes: rental.pre_existing_damage_notes,
    prePhotoUrls: rental.pre_rental_photo_urls || [],
    postPhotoUrls,
    returnConditionNotes,
    fuelTankEmptyAtReturn: fuelTankEmpty,
    lateFeeAmount,
    damageChargeAmount,
    fuelChargeAmount,
    rentalChargeTotal: Number(rental.rental_charge),
    amountDue: balanceDue,
    returned: true,
    actualReturnDate: now.toISOString().slice(0, 10),
    logoUrl,
  })

  let agreementPdfUrl: string | null = null
  try {
    const fileName = `${rental.id}.pdf`
    const { error: uploadError } = await supabase.storage
      .from('rentals')
      .upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: true })
    if (!uploadError) {
      const { data: { publicUrl } } = supabase.storage.from('rentals').getPublicUrl(fileName)
      agreementPdfUrl = publicUrl
      await supabase.from('rentals').update({ agreement_pdf_url: publicUrl }).eq('id', rental.id)
    }
  } catch (err) {
    console.error('Failed to update rental agreement PDF:', err)
  }

  revalidatePath('/rentals')
  revalidatePath('/')

  return NextResponse.json({ rental: { ...rental, status: 'Returned', total_owed: balanceDue, agreement_pdf_url: agreementPdfUrl } })
}

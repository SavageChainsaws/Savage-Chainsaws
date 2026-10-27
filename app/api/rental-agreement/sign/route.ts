import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getSessionInfo } from '@/lib/supabase/server'
import { renderMultiUnitRentalAgreementPdf } from '@/lib/multiUnitRentalAgreementPdf'
import { computeRentalFee, computeDepositAmount, getOwnerSignatureUrl, type RateType, type AgreementUnit } from '@/lib/multiUnitRentalAgreement'
import { toTitleCase, normalizeEmail } from '@/lib/text'
import { sendEmail } from '@/lib/email'

// Admin-only, called once the customer has drawn their signature in person
// on Jesse's device (see CreateRentalAgreementFlow) - their signature image
// is already uploaded to storage client-side by then, so this just takes
// its URL along with the rest of the agreement's fields. Finalizes in one
// shot: inserts the row, stamps Jesse's saved signature (if he's set one -
// see OwnerSignatureSetting) alongside the renter's, renders and stores the
// PDF, and emails it to both parties. Nothing here is customer-facing - the
// customer only ever sees the in-app sign screen, never this route.
export async function POST(request: NextRequest) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const customerId = (body.customerId as string) || null
  const renterName = toTitleCase(((body.renterName as string) || '').trim())
  const renterPhone = ((body.renterPhone as string) || '').trim() || null
  const renterEmailRaw = ((body.renterEmail as string) || '').trim()
  const renterEmail = renterEmailRaw ? normalizeEmail(renterEmailRaw) : null
  const unitsRaw = Array.isArray(body.units) ? (body.units as AgreementUnit[]) : []
  const units: AgreementUnit[] = unitsRaw
    .map(u => ({
      model: (u.model || '').trim(),
      serialNumber: (u.serialNumber || '').trim(),
      conditionAtPickup: (u.conditionAtPickup || '').trim(),
    }))
    .filter(u => u.model.length > 0)
  const rentalStart = (body.rentalStart as string) || ''
  const dueBack = (body.dueBack as string) || ''
  const rateTypeRaw = (body.rateType as string) || 'daily'
  const rateType: RateType = rateTypeRaw === 'three_day_package' ? 'three_day_package' : 'daily'
  const depositReceived = body.depositReceived != null ? Number(body.depositReceived) : null
  const paymentMethod = ((body.paymentMethod as string) || '').trim() || null
  const renterSignatureUrl = ((body.renterSignatureUrl as string) || '').trim()

  if (!renterName || units.length === 0 || !rentalStart || !dueBack || !renterSignatureUrl) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }
  if (new Date(dueBack) < new Date(rentalStart)) {
    return NextResponse.json({ error: 'Due back date must be on or after the rental start date.' }, { status: 400 })
  }

  const rentalFee = computeRentalFee(rateType, units.length)
  const depositAmount = computeDepositAmount(units.length)
  const ownerSignatureUrl = await getOwnerSignatureUrl(supabase)
  const now = new Date()

  const { data: agreementRow, error: insertError } = await supabase
    .from('rental_agreements')
    .insert({
      customer_id: customerId,
      renter_name: renterName,
      renter_phone: renterPhone,
      renter_email: renterEmail,
      units,
      rental_start: rentalStart,
      due_back: dueBack,
      rate_type: rateType,
      rental_fee: rentalFee,
      deposit_amount: depositAmount,
      deposit_received: depositReceived,
      payment_method: paymentMethod,
      renter_signature_url: renterSignatureUrl,
      renter_signed_at: now.toISOString(),
      owner_signature_url: ownerSignatureUrl,
      owner_signed_at: ownerSignatureUrl ? now.toISOString() : null,
    })
    .select('*')
    .single()
  if (insertError || !agreementRow) {
    return NextResponse.json({ error: insertError?.message || 'Could not save the agreement. Please try again.' }, { status: 500 })
  }

  const logoUrl = new URL('/images/logo.png', request.url).toString()
  const agreementReference = (agreementRow.id as string).slice(0, 8).toUpperCase()
  const pdfBuffer = await renderMultiUnitRentalAgreementPdf({
    agreementReference,
    agreementDate: now.toISOString().slice(0, 10),
    renter: { name: renterName, phone: renterPhone, email: renterEmail },
    units,
    rentalStart,
    dueBack,
    rateType,
    rentalFee,
    depositAmount,
    depositReceived,
    paymentMethod,
    renterSignatureUrl,
    renterSignedAt: now.toISOString(),
    ownerSignatureUrl,
    ownerSignedAt: ownerSignatureUrl ? now.toISOString() : null,
    logoUrl,
  })

  let agreementPdfUrl: string | null = null
  try {
    const fileName = `agreements/${agreementRow.id}.pdf`
    const { error: uploadError } = await supabase.storage
      .from('rentals')
      .upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: true })
    if (!uploadError) {
      const { data: { publicUrl } } = supabase.storage.from('rentals').getPublicUrl(fileName)
      agreementPdfUrl = publicUrl
      await supabase.from('rental_agreements').update({ agreement_pdf_url: publicUrl }).eq('id', agreementRow.id)
    }
  } catch (err) {
    console.error('Failed to save rental agreement PDF:', err)
  }

  if (agreementPdfUrl) {
    const recipients = ['service@savagechainsaws.com', ...(renterEmail ? [renterEmail] : [])]
    const emailResult = await sendEmail({
      to: recipients,
      from: 'Savage Chainsaws <service@savagechainsaws.com>',
      subject: `Signed Rental Agreement ${agreementReference}`,
      html: `
        <p>The rental agreement for ${renterName} (${units.length} unit${units.length === 1 ? '' : 's'}: ${units.map(u => u.model).join(', ')}) has been signed.</p>
        <p>Rental period: ${rentalStart} to ${dueBack}<br/>Rental fee: $${rentalFee.toFixed(2)}<br/>Security deposit: $${depositAmount.toFixed(2)}</p>
        <p>The signed agreement is attached as a PDF.</p>
      `,
      attachments: [{ filename: `rental-agreement-${agreementReference}.pdf`, path: agreementPdfUrl }],
    })
    if (emailResult.ok) {
      await supabase.from('rental_agreements').update({ sent_at: new Date().toISOString() }).eq('id', agreementRow.id)
    } else {
      console.error('Failed to email signed rental agreement:', emailResult.error)
    }
  }

  revalidatePath('/rentals')

  return NextResponse.json({ ok: true, pdfUrl: agreementPdfUrl })
}

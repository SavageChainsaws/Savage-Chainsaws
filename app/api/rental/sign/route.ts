import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { renderRentalAgreementPdf } from '@/lib/rentalAgreementPdf'
import { sendPushToAdmins } from '@/lib/push'
import { unitLabel } from '@/lib/units'

// Called by a signed-in customer from the portal's rental-sign card (see
// RentalSignCard) - not admin-gated, since this IS the customer-facing
// action. Trust boundary is the sign_rental_agreement() SECURITY DEFINER
// RPC: it only flips a rental to Active if the caller's own auth.uid()
// owns the customers row the rental is linked to, and only while the
// rental is still 'Pending Signature'. Everything after the RPC call
// (PDF generation, storage upload) just formalizes a write that already
// succeeded under that check.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const rentalId = (body?.rentalId as string) || ''
  const signedName = ((body?.signedName as string) || '').trim()
  if (!rentalId || !signedName) {
    return NextResponse.json({ error: 'Missing rental id or signed name.' }, { status: 400 })
  }

  const { error: rpcError } = await supabase.rpc('sign_rental_agreement', {
    p_rental_id: rentalId,
    p_signed_name: signedName,
  })
  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 400 })
  }

  const { data: rentalRow } = await supabase
    .from('rentals')
    .select('*, rental_units(model, equipment_type, serial_number)')
    .eq('id', rentalId)
    .single()
  if (!rentalRow) {
    return NextResponse.json({ error: 'Signed, but could not load the rental to generate the PDF.' }, { status: 500 })
  }
  const rentalUnit = rentalRow.rental_units as unknown as { model: string; equipment_type: string; serial_number: string | null } | null

  const logoUrl = new URL('/images/logo.png', request.url).toString()
  const pdfBuffer = await renderRentalAgreementPdf({
    rentalReference: (rentalRow.id as string).slice(0, 8).toUpperCase(),
    agreementDate: (rentalRow.created_at as string).slice(0, 10),
    unit: {
      model: rentalUnit?.model || '',
      equipmentType: rentalUnit?.equipment_type || '',
      serialNumber: rentalUnit?.serial_number || null,
    },
    renter: {
      name: rentalRow.renter_name as string,
      company: rentalRow.renter_company as string | null,
      phone: rentalRow.renter_phone as string | null,
      license: rentalRow.driver_license as string | null,
    },
    rentalType: rentalRow.rental_type as 'daily' | 'weekly',
    rateAmount: Number(rentalRow.rate_amount),
    startDate: rentalRow.start_date as string,
    endDate: rentalRow.end_date as string,
    securityDeposit: Number(rentalRow.security_deposit),
    damageCap: Number(rentalRow.damage_cap_amount),
    preExistingDamageNotes: rentalRow.pre_existing_damage_notes as string | null,
    prePhotoUrls: (rentalRow.pre_rental_photo_urls as string[]) || [],
    postPhotoUrls: [],
    returnConditionNotes: null,
    fuelTankEmptyAtReturn: null,
    lateFeeAmount: 0,
    damageChargeAmount: 0,
    fuelChargeAmount: 0,
    rentalChargeTotal: Number(rentalRow.rental_charge),
    amountDue: Number(rentalRow.total_owed),
    returned: false,
    actualReturnDate: null,
    logoUrl,
    agreementSignedName: rentalRow.agreement_signed_name as string | null,
    agreementSignedAt: rentalRow.agreement_signed_at as string | null,
  })

  // The customer has no storage-insert grant on the 'rentals' bucket (admin
  // only) - ownership and status were already verified by the RPC above, so
  // using the admin client here to store the now-finalized PDF is safe.
  let agreementPdfUrl: string | null = null
  const admin = createAdminClient()
  if (admin) {
    try {
      const fileName = `${rentalRow.id}.pdf`
      const { error: uploadError } = await admin.storage
        .from('rentals')
        .upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: true })
      if (!uploadError) {
        const { data: { publicUrl } } = admin.storage.from('rentals').getPublicUrl(fileName)
        agreementPdfUrl = publicUrl
        await admin.from('rentals').update({ agreement_pdf_url: publicUrl }).eq('id', rentalRow.id)
      }
    } catch (err) {
      console.error('Failed to save signed rental agreement PDF:', err)
    }
  }

  await sendPushToAdmins({
    title: 'Rental agreement signed',
    body: `${rentalRow.renter_name} signed for ${unitLabel(rentalUnit || {})} - send the payment link.`,
    url: `/rentals?customer=${rentalRow.customer_id}`,
    tag: `rental-${rentalRow.id}`,
  })

  revalidatePath('/rentals')
  revalidatePath('/customer')

  return NextResponse.json({ ok: true, agreementPdfUrl })
}

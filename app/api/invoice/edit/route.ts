import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getSessionInfo } from '@/lib/supabase/server'
import { resolveUnitParts, type ResolvedPart } from '@/lib/parts'
import { renderInvoicePdf } from '@/lib/invoicePdf'
import { computeInvoiceBilling, getDefaultTaxRatePercent, type LaborType } from '@/lib/billing'

function matchPartSku(description: string, parts: ResolvedPart[]): string | undefined {
  const descWords = new Set((description.toLowerCase().match(/[a-z0-9]+/g) || []).filter(w => w.length >= 4))
  if (descWords.size === 0) return undefined
  let best: { sku: string; score: number } | null = null
  for (const p of parts) {
    const nameWords = (p.part_name.toLowerCase().match(/[a-z0-9]+/g) || []).filter(w => w.length >= 4)
    const score = nameWords.filter(w => descWords.has(w)).length
    if (score > 0 && (!best || score > best.score)) best = { sku: p.sku, score }
  }
  return best?.sku
}

// Admin-only. Re-saves an already-generated invoice's line items - the
// "mid-service change request" flow (customer calls, wants a chain added),
// available both from a unit's expanded panel and directly from the /invoices
// table (EditInvoiceButton) via the shared EditInvoiceForm. Deliberately
// mirrors app/api/invoice/route.ts's computation almost exactly (same
// billing rules, same PDF renderer) but UPDATEs the existing invoices row in
// place rather than inserting a new one, and reuses the existing
// invoice_number and storage filename so nothing about the invoice's
// identity changes - only its contents and total.
//
// Works for both invoice shapes: a unit-linked invoice (unit_id set) gets
// its real unit's identity + resolved parts back in the regenerated PDF and
// SKU matching, same as creation; a standalone/custom invoice (no unit_id -
// see app/api/invoice/custom/route.ts) has no unit to look up at all, so the
// PDF regenerates without a unit block, matching how it was first created.
// Which case applies is read from the invoice's own stored unit_id, never
// trusted from the client.
export async function POST(request: NextRequest) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const formData = await request.formData()
  const invoiceId = (formData.get('invoice_id') as string) || ''
  const partsDescriptions = formData.getAll('parts_description') as string[]
  const partsPrices = formData.getAll('parts_price') as string[]
  const laborDescriptions = formData.getAll('labor_description') as string[]
  const laborPrices = formData.getAll('labor_price') as string[]
  const priorityFeeRaw = formData.get('priority_fee') as string
  const referralDiscountAmount = Number(formData.get('referral_discount_amount')) || 0
  const laborTypeRaw = formData.get('labor_type') as string
  const taxRatePercentRaw = formData.get('tax_rate_percent') as string
  const includeCardSurcharge = formData.get('include_card_surcharge') === 'true'
  if (!invoiceId) {
    return NextResponse.json({ error: 'Missing invoice_id' }, { status: 400 })
  }

  const { data: existingInvoice } = await supabase
    .from('invoices')
    .select('id, unit_id, customer_id, customer_name, customer_email, invoice_number, paid_at, square_payment_link_url')
    .eq('id', invoiceId)
    .single()
  if (!existingInvoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }
  const unitId = existingInvoice.unit_id as string | null

  const rawPartsLineItems = partsDescriptions
    .map((description, i) => ({ description: description.trim(), amount: Number(partsPrices[i]) || 0 }))
    .filter(li => li.description.length > 0)
  const rawLaborLineItems = laborDescriptions
    .map((description, i) => ({ description: description.trim(), amount: Number(laborPrices[i]) || 0 }))
    .filter(li => li.description.length > 0)
  const priorityFee = priorityFeeRaw ? Number(priorityFeeRaw) : 0

  if (rawPartsLineItems.length === 0 && rawLaborLineItems.length === 0 && !priorityFee) {
    return NextResponse.json({ error: 'Add at least one line item with a description.' }, { status: 400 })
  }

  const hasParts = rawPartsLineItems.length > 0
  const laborType: LaborType = laborTypeRaw === 'STLA' || laborTypeRaw === 'NTSTLA' ? laborTypeRaw : hasParts ? 'STLA' : 'NTSTLA'
  const laborLineItems = rawLaborLineItems.map(li => ({ ...li, description: `${li.description} (${laborType})` }))
  const taxRatePercent = taxRatePercentRaw && Number.isFinite(Number(taxRatePercentRaw))
    ? Number(taxRatePercentRaw)
    : await getDefaultTaxRatePercent(supabase)

  const { data: unit } = unitId
    ? await supabase
        .from('units')
        .select('id, model, serial_number, equipment_type, customer_id, nickname, thumbnail_url, photo_url')
        .eq('id', unitId)
        .single()
    : { data: null }
  if (unitId && !unit) {
    return NextResponse.json({ error: 'Unit not found' }, { status: 404 })
  }

  const customerIdForLookup = unit?.customer_id || existingInvoice.customer_id
  const { data: customer } = customerIdForLookup
    ? await supabase
        .from('customers')
        .select('name, email, phone, logo_url, brand_color')
        .eq('id', customerIdForLookup)
        .single()
    : { data: null }

  let resolvedParts: ResolvedPart[] = []
  if (unit) {
    const [{ data: modelPartsAll }, { data: unitOverrides }] = await Promise.all([
      supabase.from('model_parts').select('*'),
      supabase.from('unit_part_overrides').select('*').eq('unit_id', unit.id),
    ])
    resolvedParts = resolveUnitParts(unit, modelPartsAll || [], unitOverrides || [])
  }
  const partsLineItems = rawPartsLineItems.map(li => ({ ...li, sku: matchPartSku(li.description, resolvedParts) }))

  const now = new Date()
  const logoUrl = new URL('/images/logo.png', request.url).toString()

  // The referral discount, if this invoice originally had one, carries
  // forward unchanged - it's a one-time flag already flipped on the
  // customer's record when the invoice was first created, so editing later
  // never re-evaluates eligibility or re-applies it.
  const partsAndLaborSubtotal = [...partsLineItems, ...laborLineItems].reduce((sum, li) => sum + li.amount, 0)

  const billing = computeInvoiceBilling({
    taxableSubtotal: partsAndLaborSubtotal,
    otherCharges: priorityFee - referralDiscountAmount,
    hasParts,
    taxRatePercent,
    includeCardSurcharge,
  })

  const lineItems = [
    ...partsLineItems,
    ...laborLineItems,
    ...(referralDiscountAmount > 0 ? [{ description: 'Referral Discount (10%)', amount: -referralDiscountAmount }] : []),
    ...(priorityFeeRaw ? [{ description: 'Priority Fee', amount: priorityFee }] : []),
    ...(billing.taxLine ? [billing.taxLine] : []),
    ...(billing.surchargeLine ? [billing.surchargeLine] : []),
  ]
  const invoiceTotal = lineItems.reduce((sum, li) => sum + li.amount, 0)

  const pdfBuffer = await renderInvoicePdf({
    invoiceNumber: existingInvoice.invoice_number,
    invoiceDate: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    customer: {
      name: customer?.name || existingInvoice.customer_name || 'Customer',
      email: customer?.email ?? existingInvoice.customer_email ?? null,
      phone: customer?.phone ?? null,
      logoUrl: customer?.logo_url ?? null,
      brandColor: customer?.brand_color ?? null,
    },
    unit: unit
      ? {
          model: unit.model,
          serialNumber: unit.serial_number,
          equipmentType: unit.equipment_type,
          nickname: unit.nickname,
          thumbnailUrl: unit.thumbnail_url || unit.photo_url || null,
        }
      : null,
    lineItems,
    logoUrl,
    laborOnlyNote: billing.laborOnlyNote,
    showCardSurchargeDisclosure: !!billing.surchargeLine,
  })

  // Editing the total invalidates any payment link already generated for
  // the old amount - clear it so the invoices list falls back to showing
  // "Generate Payment Link" instead of a Pay Now button that would charge
  // the wrong total. Never touched once the invoice is actually paid.
  const clearStalePaymentLink = !existingInvoice.paid_at && !!existingInvoice.square_payment_link_url

  await supabase
    .from('invoices')
    .update({
      line_items: lineItems,
      amount: invoiceTotal,
      sales_tax_rate: taxRatePercent,
      sales_tax_amount: billing.taxAmount,
      card_surcharge_amount: billing.surchargeAmount,
      labor_type: laborType,
      ...(clearStalePaymentLink
        ? { square_payment_link_id: null, square_order_id: null, square_payment_link_url: null }
        : {}),
    })
    .eq('id', invoiceId)

  const fileName = `${invoiceId}.pdf`
  const { error: uploadError } = await supabase.storage
    .from('invoices')
    .upload(fileName, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    })
  if (!uploadError) {
    const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(fileName)
    if (unitId) {
      await supabase.from('units').update({ invoice_url: publicUrl }).eq('id', unitId)
    }
    await supabase.from('invoices').update({ pdf_url: publicUrl }).eq('id', invoiceId)
  }

  revalidatePath('/')
  revalidatePath('/invoices')

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="invoice-${existingInvoice.invoice_number}.pdf"`,
    },
  })
}

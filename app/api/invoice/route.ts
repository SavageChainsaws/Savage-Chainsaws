import { NextRequest, NextResponse } from 'next/server'
import { getSessionInfo } from '@/lib/supabase/server'
import { resolveUnitParts, type ResolvedPart } from '@/lib/parts'
import { renderInvoicePdf } from '@/lib/invoicePdf'

// Admin types a free-text Parts line item (e.g. "Replacement chain") with
// no dropdown tying it to a specific catalog part, so there's no exact key
// to join on - only the resolved model-parts/overrides list for this unit.
// Score each candidate by how many significant (4+ letter/digit) words it
// shares with the typed description and take the best match, so "Stock
// mower blade" correctly prefers "STOCK MOWER BLADE" over the less
// specific "HIGH LIFT BLADE" rather than matching on "blade" alone.
// Returns undefined (no SKU shown) rather than guess when nothing shares
// a word - a missing SKU is far less misleading than a wrong one on a
// document customers use for their own bookkeeping.
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

// Admin-only. Generates a PDF invoice on demand from a unit's current
// data plus admin-entered fee amounts, and saves it as the unit's current
// invoice/quote (units.invoice_url) - reused as-is whether this runs at
// the diagnosis step (an estimate the customer reviews before approving
// work) or later for a final invoice. The same unit can be re-invoiced any
// time with different numbers; each run replaces the previous document.
export async function POST(request: NextRequest) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const formData = await request.formData()
  const unitId = (formData.get('unit_id') as string) || ''
  const partsDescriptions = formData.getAll('parts_description') as string[]
  const partsPrices = formData.getAll('parts_price') as string[]
  const laborDescriptions = formData.getAll('labor_description') as string[]
  const laborPrices = formData.getAll('labor_price') as string[]
  const priorityFeeRaw = formData.get('priority_fee') as string
  if (!unitId) {
    return NextResponse.json({ error: 'Missing unit_id' }, { status: 400 })
  }

  const rawPartsLineItems = partsDescriptions
    .map((description, i) => ({ description: description.trim(), amount: Number(partsPrices[i]) || 0 }))
    .filter(li => li.description.length > 0)
  const laborLineItems = laborDescriptions
    .map((description, i) => ({ description: description.trim(), amount: Number(laborPrices[i]) || 0 }))
    .filter(li => li.description.length > 0)
  const priorityFee = priorityFeeRaw ? Number(priorityFeeRaw) : 0

  if (rawPartsLineItems.length === 0 && laborLineItems.length === 0 && !priorityFee) {
    return NextResponse.json({ error: 'Add at least one line item with a description.' }, { status: 400 })
  }

  const { data: unit } = await supabase
    .from('units')
    .select('id, model, serial_number, equipment_type, customer_id, nickname, thumbnail_url, photo_url')
    .eq('id', unitId)
    .single()
  if (!unit) {
    return NextResponse.json({ error: 'Unit not found' }, { status: 404 })
  }

  const { data: customer } = unit.customer_id
    ? await supabase
        .from('customers')
        .select('name, email, phone, logo_url, brand_color, referral_source_id, referral_discount_used')
        .eq('id', unit.customer_id)
        .single()
    : { data: null }

  const [{ data: modelPartsAll }, { data: unitOverrides }] = await Promise.all([
    supabase.from('model_parts').select('*'),
    supabase.from('unit_part_overrides').select('*').eq('unit_id', unitId),
  ])
  const resolvedParts = resolveUnitParts(unit, modelPartsAll || [], unitOverrides || [])
  // Attach each Parts line item's best-matching SKU (if any) so it prints
  // directly under that line in the PDF, instead of every resolved part
  // for the unit's model being dumped in one disconnected list at the
  // bottom regardless of what was actually invoiced.
  const partsLineItems = rawPartsLineItems.map(li => ({ ...li, sku: matchPartSku(li.description, resolvedParts) }))

  const now = new Date()
  // Shared, atomic sequence (SC-0001, SC-0002, ...) - see migration
  // add_sequential_invoice_numbering. Replaces the old
  // SC-<date>-<unit id prefix> format, which wasn't a clean sequence and
  // wasn't unique across re-invoices of different units on the same day.
  const { data: invoiceNumber, error: numberError } = await supabase.rpc('next_invoice_number')
  if (numberError || !invoiceNumber) {
    return NextResponse.json({ error: 'Could not generate an invoice number. Please try again.' }, { status: 500 })
  }
  const logoUrl = new URL('/images/logo.png', request.url).toString()

  // First-service referral discount - 10% off the itemized parts+labor
  // subtotal only (never the priority fee), applied automatically exactly
  // once per referred customer. referral_discount_used is flipped after the
  // invoice row below is successfully saved, so a failed save never burns
  // the discount without the customer actually getting it on a document.
  const applyReferralDiscount = !!customer?.referral_source_id && !customer?.referral_discount_used
  const partsAndLaborSubtotal = [...partsLineItems, ...laborLineItems].reduce((sum, li) => sum + li.amount, 0)
  const referralDiscountAmount = applyReferralDiscount ? Math.round(partsAndLaborSubtotal * 0.10 * 100) / 100 : 0

  const lineItems = [
    ...partsLineItems,
    ...laborLineItems,
    ...(applyReferralDiscount ? [{ description: 'Referral Discount (10%)', amount: -referralDiscountAmount }] : []),
    ...(priorityFeeRaw ? [{ description: 'Priority Fee', amount: priorityFee }] : []),
  ]
  const invoiceTotal = lineItems.reduce((sum, li) => sum + li.amount, 0)

  const pdfBuffer = await renderInvoicePdf({
    invoiceNumber,
    invoiceDate: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    customer: {
      name: customer?.name || 'Customer',
      email: customer?.email ?? null,
      phone: customer?.phone ?? null,
      logoUrl: customer?.logo_url ?? null,
      brandColor: customer?.brand_color ?? null,
    },
    unit: {
      model: unit.model,
      serialNumber: unit.serial_number,
      equipmentType: unit.equipment_type,
      nickname: unit.nickname,
      thumbnailUrl: unit.thumbnail_url || unit.photo_url || null,
    },
    lineItems,
    logoUrl,
  })

  // Best-effort: save this as the unit's current invoice/quote so it shows
  // up for the customer (e.g. alongside diagnosis notes, before they
  // decide), and as a full itemized record in the invoices table for the
  // admin's own bookkeeping (see /invoices). A storage/DB hiccup here
  // shouldn't block handing the admin back the PDF they just generated.
  //
  // The invoices row is inserted BEFORE the storage upload so the upload
  // path can key off the row's own id, which is always unique - the
  // previous `${unitId}-${invoiceNumber}` filename collided (same day +
  // same unit = same name) whenever a unit was re-invoiced more than once
  // in one day, silently failing the re-upload since it used upsert:false.
  try {
    const { data: invoiceRow } = await supabase
      .from('invoices')
      .insert({
        unit_id: unitId,
        customer_id: unit.customer_id,
        customer_name: customer?.name || null,
        customer_email: customer?.email || null,
        invoice_number: invoiceNumber,
        line_items: lineItems,
        amount: invoiceTotal,
        description: `Invoice ${invoiceNumber}`,
        status: 'sent',
      })
      .select('id')
      .single()

    if (applyReferralDiscount && invoiceRow?.id && unit.customer_id) {
      await supabase.from('customers').update({ referral_discount_used: true }).eq('id', unit.customer_id)
    }

    const fileName = `${invoiceRow?.id || `${unitId}-${invoiceNumber}`}.pdf`
    const { error: uploadError } = await supabase.storage
      .from('invoices')
      .upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      })
    if (!uploadError) {
      const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(fileName)
      await supabase.from('units').update({ invoice_url: publicUrl }).eq('id', unitId)
      if (invoiceRow?.id) {
        await supabase.from('invoices').update({ pdf_url: publicUrl }).eq('id', invoiceRow.id)
      }
    }
  } catch (err) {
    console.error('Failed to save generated invoice to unit:', err)
  }

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="invoice-${invoiceNumber}.pdf"`,
    },
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { getSessionInfo } from '@/lib/supabase/server'
import { resolveUnitParts } from '@/lib/parts'
import { renderInvoicePdf } from '@/lib/invoicePdf'

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

  const partsLineItems = partsDescriptions
    .map((description, i) => ({ description: description.trim(), amount: Number(partsPrices[i]) || 0 }))
    .filter(li => li.description.length > 0)
  const laborLineItems = laborDescriptions
    .map((description, i) => ({ description: description.trim(), amount: Number(laborPrices[i]) || 0 }))
    .filter(li => li.description.length > 0)
  const priorityFee = priorityFeeRaw ? Number(priorityFeeRaw) : 0

  if (partsLineItems.length === 0 && laborLineItems.length === 0 && !priorityFee) {
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
    ? await supabase.from('customers').select('name, email, phone, logo_url, brand_color').eq('id', unit.customer_id).single()
    : { data: null }

  const [{ data: modelPartsAll }, { data: unitOverrides }] = await Promise.all([
    supabase.from('model_parts').select('*'),
    supabase.from('unit_part_overrides').select('*').eq('unit_id', unitId),
  ])
  const parts = resolveUnitParts(unit, modelPartsAll || [], unitOverrides || [])

  const now = new Date()
  const invoiceNumber = `SC-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${unitId.slice(0, 6).toUpperCase()}`
  const logoUrl = new URL('/images/logo.png', request.url).toString()

  const lineItems = [
    ...partsLineItems,
    ...laborLineItems,
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
    parts: parts.map(p => ({ name: p.part_name, sku: p.sku })),
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
        invoice_number: invoiceNumber,
        line_items: lineItems,
        amount: invoiceTotal,
        description: `Invoice ${invoiceNumber}`,
        status: 'sent',
      })
      .select('id')
      .single()

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

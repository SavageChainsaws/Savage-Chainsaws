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
  const serviceFeeRaw = formData.get('service_fee') as string
  const partsTotalRaw = formData.get('parts_total') as string
  const priorityFeeRaw = formData.get('priority_fee') as string
  if (!unitId) {
    return NextResponse.json({ error: 'Missing unit_id' }, { status: 400 })
  }

  const { data: unit } = await supabase
    .from('units')
    .select('id, model, serial_number, equipment_type, customer_id')
    .eq('id', unitId)
    .single()
  if (!unit) {
    return NextResponse.json({ error: 'Unit not found' }, { status: 404 })
  }

  const { data: customer } = unit.customer_id
    ? await supabase.from('customers').select('name, email, phone').eq('id', unit.customer_id).single()
    : { data: null }

  const [{ data: modelPartsAll }, { data: unitOverrides }] = await Promise.all([
    supabase.from('model_parts').select('*'),
    supabase.from('unit_part_overrides').select('*').eq('unit_id', unitId),
  ])
  const parts = resolveUnitParts(unit, modelPartsAll || [], unitOverrides || [])

  const now = new Date()
  const invoiceNumber = `SC-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${unitId.slice(0, 6).toUpperCase()}`
  const logoUrl = new URL('/images/logo.png', request.url).toString()

  const pdfBuffer = await renderInvoicePdf({
    invoiceNumber,
    invoiceDate: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    customer: {
      name: customer?.name || 'Customer',
      email: customer?.email ?? null,
      phone: customer?.phone ?? null,
    },
    unit: {
      model: unit.model,
      serialNumber: unit.serial_number,
      equipmentType: unit.equipment_type,
    },
    lineItems: [
      { description: 'Labor / Service Fee', amount: serviceFeeRaw ? Number(serviceFeeRaw) : 0 },
      { description: 'Parts Total', amount: partsTotalRaw ? Number(partsTotalRaw) : 0 },
      ...(priorityFeeRaw ? [{ description: 'Priority Fee', amount: Number(priorityFeeRaw) }] : []),
    ],
    parts: parts.map(p => ({ name: p.part_name, sku: p.sku })),
    logoUrl,
  })

  // Best-effort: save this as the unit's current invoice/quote so it shows
  // up for the customer (e.g. alongside diagnosis notes, before they
  // decide). A storage/DB hiccup here shouldn't block handing the admin
  // back the PDF they just generated.
  try {
    const fileName = `${unitId}-${invoiceNumber}.pdf`
    const { error: uploadError } = await supabase.storage
      .from('invoices')
      .upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: false,
      })
    if (!uploadError) {
      const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(fileName)
      await supabase.from('units').update({ invoice_url: publicUrl }).eq('id', unitId)
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

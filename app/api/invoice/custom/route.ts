import { NextRequest, NextResponse } from 'next/server'
import { getSessionInfo } from '@/lib/supabase/server'
import { renderInvoicePdf } from '@/lib/invoicePdf'

// Admin-only. Builds a free-form, itemized PDF invoice from whatever the
// admin submitted - whether those fields came from selecting a customer
// (autofilled client-side, then possibly hand-edited) or were typed from
// scratch. Either way the server just takes the submitted values as-is;
// there's no server-side customer lookup, so this also works for a
// one-off invoice with no tracked customer or unit at all.
export async function POST(request: NextRequest) {
  const { isAdmin } = await getSessionInfo()
  if (!isAdmin) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const formData = await request.formData()
  const customerName = ((formData.get('customer_name') as string) || '').trim() || 'Customer'
  const customerEmail = ((formData.get('customer_email') as string) || '').trim() || null
  const customerPhone = ((formData.get('customer_phone') as string) || '').trim() || null

  const unitModel = ((formData.get('unit_model') as string) || '').trim() || null
  const unitSerial = ((formData.get('unit_serial') as string) || '').trim() || null
  const unitEquipmentType = ((formData.get('unit_equipment_type') as string) || '').trim() || null
  const hasUnitInfo = !!(unitModel || unitSerial || unitEquipmentType)

  const descriptions = formData.getAll('description') as string[]
  const prices = formData.getAll('price') as string[]
  const lineItems = descriptions
    .map((description, i) => ({ description: description.trim(), amount: Number(prices[i]) || 0 }))
    .filter(li => li.description.length > 0)

  if (lineItems.length === 0) {
    return NextResponse.json({ error: 'Add at least one line item with a description.' }, { status: 400 })
  }

  const now = new Date()
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  const invoiceNumber = `SC-${stamp}`
  const logoUrl = new URL('/images/logo.png', request.url).toString()

  const pdfBuffer = await renderInvoicePdf({
    invoiceNumber,
    invoiceDate: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    customer: { name: customerName, email: customerEmail, phone: customerPhone },
    unit: hasUnitInfo ? { model: unitModel, serialNumber: unitSerial, equipmentType: unitEquipmentType } : null,
    lineItems,
    logoUrl,
  })

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="invoice-${invoiceNumber}.pdf"`,
    },
  })
}

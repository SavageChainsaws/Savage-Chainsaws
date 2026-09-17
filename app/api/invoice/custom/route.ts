import { NextRequest, NextResponse } from 'next/server'
import { getSessionInfo } from '@/lib/supabase/server'
import { renderInvoicePdf } from '@/lib/invoicePdf'

// Admin-only. Builds a free-form, itemized PDF invoice from whatever the
// admin submitted - whether those fields came from selecting a customer
// (autofilled client-side, then possibly hand-edited) or were typed from
// scratch. The submitted name/email/phone are always taken as-is (an
// admin can hand-edit them after selecting a customer, and that edit
// should stick) - this also works for a one-off invoice with no tracked
// customer or unit at all. customer_id is only used to pull that
// customer's logo/brand color for the PDF and to link the saved invoices
// row back to them; it's never used to override the text fields.
export async function POST(request: NextRequest) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const formData = await request.formData()
  const customerId = ((formData.get('customer_id') as string) || '').trim() || null
  const customerName = ((formData.get('customer_name') as string) || '').trim() || 'Customer'
  const customerEmail = ((formData.get('customer_email') as string) || '').trim() || null
  const customerPhone = ((formData.get('customer_phone') as string) || '').trim() || null

  const { data: linkedCustomer } = customerId
    ? await supabase
        .from('customers')
        .select('logo_url, brand_color, referral_source_id, referral_discount_used')
        .eq('id', customerId)
        .maybeSingle()
    : { data: null }

  const unitModel = ((formData.get('unit_model') as string) || '').trim() || null
  const unitSerial = ((formData.get('unit_serial') as string) || '').trim() || null
  const unitEquipmentType = ((formData.get('unit_equipment_type') as string) || '').trim() || null
  const hasUnitInfo = !!(unitModel || unitSerial || unitEquipmentType)

  const descriptions = formData.getAll('description') as string[]
  const prices = formData.getAll('price') as string[]
  const typedLineItems = descriptions
    .map((description, i) => ({ description: description.trim(), amount: Number(prices[i]) || 0 }))
    .filter(li => li.description.length > 0)

  if (typedLineItems.length === 0) {
    return NextResponse.json({ error: 'Add at least one line item with a description.' }, { status: 400 })
  }

  // First-service referral discount - see app/api/invoice/route.ts for the
  // full reasoning. Here the whole typed subtotal counts as "itemized
  // parts+labor" since this form has no separate priority-fee field.
  const applyReferralDiscount = !!linkedCustomer?.referral_source_id && !linkedCustomer?.referral_discount_used
  const typedSubtotal = typedLineItems.reduce((sum, li) => sum + li.amount, 0)
  const referralDiscountAmount = applyReferralDiscount ? Math.round(typedSubtotal * 0.10 * 100) / 100 : 0
  const lineItems = [
    ...typedLineItems,
    ...(applyReferralDiscount ? [{ description: 'Referral Discount (10%)', amount: -referralDiscountAmount }] : []),
  ]

  const now = new Date()
  // Shared, atomic sequence (SC-0001, SC-0002, ...) - same one the
  // per-unit route uses (see migration add_sequential_invoice_numbering),
  // so numbering stays continuous across both invoice creation paths
  // instead of each having its own disjoint scheme.
  const { data: invoiceNumber, error: numberError } = await supabase.rpc('next_invoice_number')
  if (numberError || !invoiceNumber) {
    return NextResponse.json({ error: 'Could not generate an invoice number. Please try again.' }, { status: 500 })
  }
  const logoUrl = new URL('/images/logo.png', request.url).toString()
  const invoiceTotal = lineItems.reduce((sum, li) => sum + li.amount, 0)

  const pdfBuffer = await renderInvoicePdf({
    invoiceNumber,
    invoiceDate: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    customer: {
      name: customerName,
      email: customerEmail,
      phone: customerPhone,
      logoUrl: linkedCustomer?.logo_url ?? null,
      brandColor: linkedCustomer?.brand_color ?? null,
    },
    unit: hasUnitInfo ? { model: unitModel, serialNumber: unitSerial, equipmentType: unitEquipmentType } : null,
    lineItems,
    logoUrl,
  })

  // Best-effort record for the admin's own bookkeeping (see /invoices) -
  // standalone invoices didn't save anything at all before this. No
  // unit_id, since "unit info" here is free-typed text, not a real
  // tracked unit to link to.
  try {
    const { data: invoiceRow } = await supabase
      .from('invoices')
      .insert({
        customer_id: customerId,
        customer_name: customerName,
        invoice_number: invoiceNumber,
        line_items: lineItems,
        amount: invoiceTotal,
        description: `Invoice ${invoiceNumber}`,
        status: 'sent',
      })
      .select('id')
      .single()

    if (applyReferralDiscount && invoiceRow?.id && customerId) {
      await supabase.from('customers').update({ referral_discount_used: true }).eq('id', customerId)
    }

    if (invoiceRow?.id) {
      const fileName = `${invoiceRow.id}.pdf`
      const { error: uploadError } = await supabase.storage
        .from('invoices')
        .upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: true })
      if (!uploadError) {
        const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(fileName)
        await supabase.from('invoices').update({ pdf_url: publicUrl }).eq('id', invoiceRow.id)
      }
    }
  } catch (err) {
    console.error('Failed to save generated custom invoice:', err)
  }

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="invoice-${invoiceNumber}.pdf"`,
    },
  })
}

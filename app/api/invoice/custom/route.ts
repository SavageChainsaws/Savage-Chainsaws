import { NextRequest, NextResponse } from 'next/server'
import { getSessionInfo } from '@/lib/supabase/server'
import { renderInvoicePdf } from '@/lib/invoicePdf'
import { toTitleCase, normalizeEmail } from '@/lib/text'
import { computeInvoiceBilling, getDefaultTaxRatePercent, type LaborType } from '@/lib/billing'
import { invoiceNotSavedResponse } from '@/lib/invoiceSaveFailure'

// Admin-only. Builds a free-form, itemized PDF invoice from whatever the
// admin submitted - whether those fields came from selecting a customer
// (autofilled client-side, then possibly hand-edited) or were typed from
// scratch - this also works for a one-off invoice with no tracked customer
// or unit at all. customer_id is only used to pull that customer's
// logo/brand color for the PDF and to link the saved invoices row back to
// them; it's never used to override the text fields. Name and email are
// case-normalized (Title Case / lowercase) so a hand-typed "john SMITH"
// still ends up matching the same convention as every other customer name
// on file, on the PDF and in the saved invoices row alike.
export async function POST(request: NextRequest) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const formData = await request.formData()
  const customerId = ((formData.get('customer_id') as string) || '').trim() || null
  const customerNameRaw = ((formData.get('customer_name') as string) || '').trim() || 'Customer'
  const customerName = toTitleCase(customerNameRaw)
  const customerEmailRaw = ((formData.get('customer_email') as string) || '').trim()
  const customerEmail = customerEmailRaw ? normalizeEmail(customerEmailRaw) : null
  const customerPhone = ((formData.get('customer_phone') as string) || '').trim() || null

  const { data: linkedCustomer } = customerId
    ? await supabase
        .from('customers')
        .select('logo_url, brand_color, referral_source_id, referral_discount_used, payment_plans_enabled')
        .eq('id', customerId)
        .maybeSingle()
    : { data: null }

  const unitModel = ((formData.get('unit_model') as string) || '').trim() || null
  const unitSerial = ((formData.get('unit_serial') as string) || '').trim() || null
  const unitEquipmentType = ((formData.get('unit_equipment_type') as string) || '').trim() || null
  const hasUnitInfo = !!(unitModel || unitSerial || unitEquipmentType)

  const partsDescriptions = formData.getAll('parts_description') as string[]
  const partsPrices = formData.getAll('parts_price') as string[]
  const partsQuantities = formData.getAll('parts_quantity') as string[]
  const laborDescriptions = formData.getAll('labor_description') as string[]
  const laborPrices = formData.getAll('labor_price') as string[]
  const laborTypeRaw = formData.get('labor_type') as string
  const taxRatePercentRaw = formData.get('tax_rate_percent') as string
  const includeCardSurcharge = formData.get('include_card_surcharge') === 'true'
  const notes = ((formData.get('notes') as string) || '').trim() || null
  const offerPaymentPlan = formData.get('offer_payment_plan') === 'true'

  // parts_price is always a per-unit amount - quantity multiplies it into
  // the line's actual billed amount and gets appended to the printed
  // description (e.g. "Sleeve x3") - see app/api/invoice/route.ts.
  const partsLineItems = partsDescriptions
    .map((description, i) => {
      const quantity = Math.max(1, parseInt(partsQuantities[i] || '1', 10) || 1)
      const unitPrice = Number(partsPrices[i]) || 0
      return {
        description: quantity > 1 ? `${description.trim()} x${quantity}` : description.trim(),
        amount: unitPrice * quantity,
      }
    })
    .filter(li => li.description.length > 0)
  // See app/api/invoice/route.ts - Labor descriptions go through
  // liveTitleCase client-side, so they need the same save-time toTitleCase
  // pass every other title-cased field gets.
  const rawLaborLineItems = laborDescriptions
    .map((description, i) => ({ description: toTitleCase(description), amount: Number(laborPrices[i]) || 0 }))
    .filter(li => li.description.length > 0)

  if (partsLineItems.length === 0 && rawLaborLineItems.length === 0) {
    return NextResponse.json({ error: 'Add at least one line item with a description.' }, { status: 400 })
  }

  // Any Parts line item at all makes the whole invoice taxable (Fla. Admin.
  // Code 12A-1.006) and selects the labor line's STLA type - see
  // app/api/invoice/route.ts for the full reasoning, mirrored here.
  const hasParts = partsLineItems.length > 0
  const laborType: LaborType = laborTypeRaw === 'STLA' || laborTypeRaw === 'NTSTLA' ? laborTypeRaw : hasParts ? 'STLA' : 'NTSTLA'
  const laborLineItems = rawLaborLineItems.map(li => ({ ...li, description: `${li.description} (${laborType})` }))
  const taxRatePercent = taxRatePercentRaw && Number.isFinite(Number(taxRatePercentRaw))
    ? Number(taxRatePercentRaw)
    : await getDefaultTaxRatePercent(supabase)

  // First-service referral discount - see app/api/invoice/route.ts for the
  // full reasoning. Here the parts+labor subtotal is the whole "itemized"
  // total since this form has no separate priority-fee field.
  const applyReferralDiscount = !!linkedCustomer?.referral_source_id && !linkedCustomer?.referral_discount_used
  const taxableSubtotal = [...partsLineItems, ...laborLineItems].reduce((sum, li) => sum + li.amount, 0)
  const referralDiscountAmount = applyReferralDiscount ? Math.round(taxableSubtotal * 0.10 * 100) / 100 : 0

  const billing = computeInvoiceBilling({
    taxableSubtotal,
    otherCharges: -referralDiscountAmount,
    hasParts,
    taxRatePercent,
    includeCardSurcharge,
  })

  const otherLineItems = [
    ...(applyReferralDiscount ? [{ description: 'Referral Discount (10%)', amount: -referralDiscountAmount }] : []),
    ...(billing.taxLine ? [billing.taxLine] : []),
    ...(billing.surchargeLine ? [billing.surchargeLine] : []),
  ]
  const lineItems = [...partsLineItems, ...laborLineItems, ...otherLineItems]

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
    partsLineItems,
    laborLineItems,
    otherLineItems,
    logoUrl,
    laborOnlyNote: billing.laborOnlyNote,
    showCardSurchargeDisclosure: !!billing.surchargeLine,
    notes,
  })

  // Saves this as a full itemized record in the invoices table for the
  // admin's own bookkeeping (see /invoices) - standalone invoices didn't
  // save anything at all before this. No unit_id, since "unit info" here
  // is free-typed text, not a real tracked unit to link to.
  //
  // savedOk only ever becomes true once the invoice row exists AND its PDF
  // is uploaded AND pdf_url is set - anything short of that used to still
  // return this same rendered PDF with a plain 200, indistinguishable from
  // a real save. That's exactly what happened to a real invoice (SC-0055,
  // Reliable Lawn Services, 2026-11): it rendered fine and got texted to
  // the customer as a screenshot, but never got a pdf_url, so the customer
  // could never open it from their own portal - see invoiceNotSavedResponse.
  let savedOk = false
  let saveFailureReason = 'An unexpected error occurred while saving.'
  try {
    const { data: invoiceRow, error: insertError } = await supabase
      .from('invoices')
      .insert({
        customer_id: customerId,
        customer_name: customerName,
        customer_email: customerEmail,
        invoice_number: invoiceNumber,
        line_items: lineItems,
        amount: invoiceTotal,
        description: `Invoice ${invoiceNumber}`,
        status: 'sent',
        unit_model: unitModel,
        unit_serial: unitSerial,
        sales_tax_rate: taxRatePercent,
        sales_tax_amount: billing.taxAmount,
        card_surcharge_amount: billing.surchargeAmount,
        labor_type: laborType,
        notes,
        payment_plan_offered: offerPaymentPlan && !!linkedCustomer?.payment_plans_enabled,
      })
      .select('id')
      .single()

    if (insertError || !invoiceRow?.id) {
      saveFailureReason = `The invoice record itself could not be created${insertError ? ` (${insertError.message})` : ''} - nothing was saved, so this invoice number went unused. Try again.`
    } else {
      if (applyReferralDiscount && customerId) {
        await supabase.from('customers').update({ referral_discount_used: true }).eq('id', customerId)
      }

      const fileName = `${invoiceRow.id}.pdf`
      const { error: uploadError } = await supabase.storage
        .from('invoices')
        .upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: true })
      if (uploadError) {
        saveFailureReason = `The invoice record was saved (it's in the Invoices list as ${invoiceNumber}), but its PDF failed to upload (${uploadError.message}). Open it from the Invoices list and use Edit to regenerate the PDF - don't create this invoice again from scratch.`
      } else {
        const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(fileName)
        await supabase.from('invoices').update({ pdf_url: publicUrl }).eq('id', invoiceRow.id)
        savedOk = true
      }
    }
  } catch (err) {
    console.error('Failed to save generated custom invoice:', err)
    saveFailureReason = err instanceof Error ? err.message : saveFailureReason
  }

  if (!savedOk) {
    return invoiceNotSavedResponse({ pdfBuffer, invoiceNumber, reason: saveFailureReason })
  }

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="invoice-${invoiceNumber}.pdf"`,
    },
  })
}

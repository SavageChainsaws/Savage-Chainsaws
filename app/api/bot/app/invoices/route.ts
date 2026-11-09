import { NextRequest, NextResponse } from 'next/server'
import { withBotAuth, jsonError } from '@/lib/bot/respond'
import { withIdempotency, requireIdempotencyKey } from '@/lib/bot/idempotency'
import { logBotAction } from '@/lib/bot/audit'
import { renderInvoicePdf } from '@/lib/invoicePdf'
import { computeInvoiceBilling, getDefaultTaxRatePercent, type LaborType } from '@/lib/billing'
import { toTitleCase } from '@/lib/text'

const ENDPOINT = 'POST /api/bot/app/invoices'

export async function GET(request: NextRequest) {
  return withBotAuth(request, 'app_bot', 'GET /api/bot/app/invoices', async ({ admin }) => {
    const { searchParams } = request.nextUrl
    const id = searchParams.get('id')
    const customerId = searchParams.get('customer_id')
    const status = searchParams.get('status')

    let query = admin.from('invoices').select('*').order('created_at', { ascending: false }).limit(200)
    if (id) query = admin.from('invoices').select('*').eq('id', id).limit(1)
    else {
      if (customerId) query = query.eq('customer_id', customerId)
      if (status) query = query.eq('status', status)
    }

    const { data, error } = await query
    if (error) return jsonError(500, error.message)
    return NextResponse.json({ invoices: data || [] })
  })
}

// Creates a draft invoice only - reuses the exact same billing math, PDF
// renderer, and shared invoice-number sequence as the admin flows (see
// app/api/invoice/custom/route.ts), but always saves status: 'draft'.
// There is no bot endpoint that flips a draft to 'sent' - the first real
// send of a brand-new invoice is Jesse's call, made through the normal
// admin UI (see docs/HANDOFF.md). due_date is never defaulted/assumed
// (no NET 30) - if the caller doesn't pass one, it's left null and the
// response flags it so Jesse knows to confirm payment terms.
export async function POST(request: NextRequest) {
  return withBotAuth(request, 'app_bot', ENDPOINT, async ({ admin, botName }) => {
    const idempotencyKey = requireIdempotencyKey(request)
    if (!idempotencyKey) return jsonError(400, 'Missing required Idempotency-Key header.')

    const result = await withIdempotency(admin, { botName, endpoint: ENDPOINT, idempotencyKey }, async () => {
      const body = await request.json().catch(() => ({}))
      const customerId = (body.customer_id || '').trim()
      const unitId = (body.unit_id || '').trim() || null
      const partsLineItemsRaw = Array.isArray(body.parts_line_items) ? body.parts_line_items : []
      const laborLineItemsRaw = Array.isArray(body.labor_line_items) ? body.labor_line_items : []
      const laborTypeRaw = body.labor_type
      const taxRatePercentRaw = body.tax_rate_percent
      const includeCardSurcharge = body.include_card_surcharge === true
      const notes = (body.notes || '').trim() || null
      const dueDate = (body.due_date || '').trim() || null

      if (!customerId) return { status: 400, body: { error: 'customer_id is required.' } }

      const { data: customer } = await admin
        .from('customers')
        .select('id, name, email, phone, logo_url, brand_color')
        .eq('id', customerId)
        .maybeSingle()
      if (!customer) return { status: 404, body: { error: 'customer_id does not match an existing customer.' } }

      let unit: { id: string; model: string | null; serial_number: string | null; equipment_type: string | null; nickname: string | null; customer_id: string | null } | null = null
      if (unitId) {
        const { data: foundUnit } = await admin
          .from('units')
          .select('id, model, serial_number, equipment_type, nickname, customer_id')
          .eq('id', unitId)
          .maybeSingle()
        if (!foundUnit) return { status: 404, body: { error: 'unit_id does not match an existing unit.' } }
        if (foundUnit.customer_id !== customerId) {
          return { status: 400, body: { error: 'unit_id does not belong to customer_id.' } }
        }
        unit = foundUnit
      }

      const partsLineItems = partsLineItemsRaw
        .map((li: { description?: unknown; amount?: unknown }) => ({ description: String(li.description || '').trim(), amount: Number(li.amount) || 0 }))
        .filter((li: { description: string }) => li.description.length > 0)
      const hasParts = partsLineItems.length > 0
      const laborType: LaborType = laborTypeRaw === 'STLA' || laborTypeRaw === 'NTSTLA' ? laborTypeRaw : hasParts ? 'STLA' : 'NTSTLA'
      const laborLineItems = laborLineItemsRaw
        .map((li: { description?: unknown; amount?: unknown }) => ({ description: `${toTitleCase(String(li.description || '').trim())} (${laborType})`, amount: Number(li.amount) || 0 }))
        .filter((li: { description: string }) => li.description.replace(` (${laborType})`, '').length > 0)

      if (partsLineItems.length === 0 && laborLineItems.length === 0) {
        return { status: 400, body: { error: 'Add at least one parts or labor line item with a description.' } }
      }

      const taxRatePercent = Number.isFinite(Number(taxRatePercentRaw))
        ? Number(taxRatePercentRaw)
        : await getDefaultTaxRatePercent(admin)
      const taxableSubtotal = [...partsLineItems, ...laborLineItems].reduce((sum: number, li: { amount: number }) => sum + li.amount, 0)

      const billing = computeInvoiceBilling({
        taxableSubtotal,
        otherCharges: 0,
        hasParts,
        taxRatePercent,
        includeCardSurcharge,
      })

      const otherLineItems = [
        ...(billing.taxLine ? [billing.taxLine] : []),
        ...(billing.surchargeLine ? [billing.surchargeLine] : []),
      ]
      const lineItems = [...partsLineItems, ...laborLineItems, ...otherLineItems]
      const invoiceTotal = lineItems.reduce((sum, li) => sum + li.amount, 0)

      const { data: invoiceNumber, error: numberError } = await admin.rpc('next_invoice_number')
      if (numberError || !invoiceNumber) {
        return { status: 500, body: { error: 'Could not generate an invoice number. Please try again.' } }
      }

      const now = new Date()
      const logoUrl = new URL('/images/logo.png', request.url).toString()
      const pdfBuffer = await renderInvoicePdf({
        invoiceNumber,
        invoiceDate: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        customer: {
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          logoUrl: customer.logo_url,
          brandColor: customer.brand_color,
        },
        unit: unit ? { model: unit.model, serialNumber: unit.serial_number, equipmentType: unit.equipment_type, nickname: unit.nickname } : null,
        partsLineItems,
        laborLineItems,
        otherLineItems,
        logoUrl,
        laborOnlyNote: billing.laborOnlyNote,
        showCardSurchargeDisclosure: !!billing.surchargeLine,
        notes,
      })

      const { data: invoiceRow, error: insertError } = await admin
        .from('invoices')
        .insert({
          unit_id: unitId,
          customer_id: customerId,
          customer_name: customer.name,
          customer_email: customer.email,
          invoice_number: invoiceNumber,
          line_items: lineItems,
          amount: invoiceTotal,
          description: `Invoice ${invoiceNumber}`,
          status: 'draft',
          due_date: dueDate,
          sales_tax_rate: taxRatePercent,
          sales_tax_amount: billing.taxAmount,
          card_surcharge_amount: billing.surchargeAmount,
          labor_type: laborType,
          notes,
        })
        .select('*')
        .single()
      if (insertError || !invoiceRow) {
        await logBotAction(admin, { botName, action: 'invoice_create', endpoint: ENDPOINT, outcome: 'error', detail: { message: insertError?.message } })
        return { status: 500, body: { error: insertError?.message || 'Could not save the invoice.' } }
      }

      const fileName = `${invoiceRow.id}.pdf`
      const { error: uploadError } = await admin.storage.from('invoices').upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: true })
      if (!uploadError) {
        const { data: { publicUrl } } = admin.storage.from('invoices').getPublicUrl(fileName)
        await admin.from('invoices').update({ pdf_url: publicUrl }).eq('id', invoiceRow.id)
        invoiceRow.pdf_url = publicUrl
      }

      await logBotAction(admin, { botName, action: 'invoice_create', endpoint: ENDPOINT, targetTable: 'invoices', targetId: invoiceRow.id, outcome: 'success', detail: { due_date_missing: !dueDate } })
      return { status: 201, body: { invoice: invoiceRow, due_date_missing: !dueDate } }
    })

    return NextResponse.json(result.body, { status: result.status, headers: result.replayed ? { 'Idempotent-Replay': 'true' } : undefined })
  })
}

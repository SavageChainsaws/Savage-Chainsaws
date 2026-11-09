import { NextRequest, NextResponse } from 'next/server'
import { withBotAuth, jsonError } from '@/lib/bot/respond'
import { withIdempotency, requireIdempotencyKey } from '@/lib/bot/idempotency'
import { logBotAction } from '@/lib/bot/audit'
import { forbiddenInvoicePatchReason } from '@/lib/bot/rules'
import { renderInvoicePdf } from '@/lib/invoicePdf'
import { computeInvoiceBilling, getDefaultTaxRatePercent, type LaborType } from '@/lib/billing'
import { toTitleCase } from '@/lib/text'

// Edits a DRAFT invoice only - "draft" means status = 'draft' AND sent_at
// is still null (status alone isn't enough: it's set to 'sent' at PDF-
// creation time, before any email, so a draft that's somehow already been
// emailed is not editable here either). forbiddenInvoicePatchReason is
// checked independently of that gate, as a second, explicit guard against
// the exact things App Bot must never do: change amounts on a sent
// invoice, mark paid by hand, renumber it, or set its due_date (Jesse-only).
// Both checks are re-enforced directly in the UPDATE's own .eq()/.is()
// filter below, not just checked-then-trusted beforehand - a concurrent
// send between this read and that write must not let the write through.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const endpoint = `PATCH /api/bot/app/invoices/${id}`
  return withBotAuth(request, 'app_bot', endpoint, async ({ admin, botName }) => {
    const idempotencyKey = requireIdempotencyKey(request)
    if (!idempotencyKey) return jsonError(400, 'Missing required Idempotency-Key header.')

    const result = await withIdempotency(admin, { botName, endpoint, idempotencyKey }, async () => {
      const { data: invoice } = await admin.from('invoices').select('*').eq('id', id).maybeSingle()
      if (!invoice) return { status: 404, body: { error: 'Invoice not found.' } }

      const body = await request.json().catch(() => ({}))
      const forbidden = forbiddenInvoicePatchReason({ status: invoice.status, sentAt: invoice.sent_at }, body)
      if (forbidden) {
        await logBotAction(admin, { botName, action: 'invoice_patch', endpoint, targetTable: 'invoices', targetId: id, outcome: 'denied', detail: { reason: forbidden } })
        return { status: 403, body: { error: `Forbidden: ${forbidden}` } }
      }
      if (invoice.status !== 'draft' || invoice.sent_at) {
        await logBotAction(admin, { botName, action: 'invoice_patch', endpoint, targetTable: 'invoices', targetId: id, outcome: 'denied', detail: { reason: 'not_a_draft' } })
        return { status: 403, body: { error: 'Only a draft invoice that has not yet been emailed can be edited through this endpoint.' } }
      }

      const update: Record<string, unknown> = {}
      if ('notes' in body) update.notes = (body.notes || '').trim() || null

      let lineItems = invoice.line_items as { description: string; amount: number }[] | null
      let regeneratePdf = false
      if ('parts_line_items' in body || 'labor_line_items' in body) {
        const partsLineItemsRaw = Array.isArray(body.parts_line_items) ? body.parts_line_items : []
        const laborLineItemsRaw = Array.isArray(body.labor_line_items) ? body.labor_line_items : []
        const partsLineItems = partsLineItemsRaw
          .map((li: { description?: unknown; amount?: unknown }) => ({ description: String(li.description || '').trim(), amount: Number(li.amount) || 0 }))
          .filter((li: { description: string }) => li.description.length > 0)
        const hasParts = partsLineItems.length > 0
        const laborTypeRaw = body.labor_type
        const laborType: LaborType = laborTypeRaw === 'STLA' || laborTypeRaw === 'NTSTLA' ? laborTypeRaw : hasParts ? 'STLA' : 'NTSTLA'
        const laborLineItems = laborLineItemsRaw
          .map((li: { description?: unknown; amount?: unknown }) => ({ description: `${toTitleCase(String(li.description || '').trim())} (${laborType})`, amount: Number(li.amount) || 0 }))
          .filter((li: { description: string }) => li.description.replace(` (${laborType})`, '').length > 0)

        if (partsLineItems.length === 0 && laborLineItems.length === 0) {
          return { status: 400, body: { error: 'Add at least one parts or labor line item with a description.' } }
        }

        const taxRatePercent = Number.isFinite(Number(body.tax_rate_percent))
          ? Number(body.tax_rate_percent)
          : await getDefaultTaxRatePercent(admin)
        const includeCardSurcharge = body.include_card_surcharge === true
        const taxableSubtotal = [...partsLineItems, ...laborLineItems].reduce((sum: number, li: { amount: number }) => sum + li.amount, 0)
        const billing = computeInvoiceBilling({ taxableSubtotal, otherCharges: 0, hasParts, taxRatePercent, includeCardSurcharge })
        const otherLineItems = [...(billing.taxLine ? [billing.taxLine] : []), ...(billing.surchargeLine ? [billing.surchargeLine] : [])]
        lineItems = [...partsLineItems, ...laborLineItems, ...otherLineItems]

        update.line_items = lineItems
        update.amount = lineItems.reduce((sum, li) => sum + li.amount, 0)
        update.sales_tax_rate = taxRatePercent
        update.sales_tax_amount = billing.taxAmount
        update.card_surcharge_amount = billing.surchargeAmount
        update.labor_type = laborType
        regeneratePdf = true
      }

      const { data: updated, error } = await admin
        .from('invoices')
        .update(update)
        .eq('id', id)
        .eq('status', 'draft')
        .is('sent_at', null)
        .select('*')
        .maybeSingle()
      if (error) {
        await logBotAction(admin, { botName, action: 'invoice_patch', endpoint, targetTable: 'invoices', targetId: id, outcome: 'error', detail: { message: error.message } })
        return { status: 500, body: { error: error.message } }
      }
      if (!updated) {
        // The invoice stopped being an editable draft between the read
        // above and this write (e.g. it was just emailed) - the update
        // matched zero rows rather than silently applying anyway.
        await logBotAction(admin, { botName, action: 'invoice_patch', endpoint, targetTable: 'invoices', targetId: id, outcome: 'denied', detail: { reason: 'not_a_draft_race' } })
        return { status: 409, body: { error: 'This invoice is no longer an editable draft - it may have just been sent.' } }
      }

      if (regeneratePdf) {
        const { data: customer } = updated.customer_id
          ? await admin.from('customers').select('name, email, phone, logo_url, brand_color').eq('id', updated.customer_id).maybeSingle()
          : { data: null }
        const { data: unit } = updated.unit_id
          ? await admin.from('units').select('model, serial_number, equipment_type, nickname').eq('id', updated.unit_id).maybeSingle()
          : { data: null }
        const partsLineItems = (lineItems || []).filter(li => !/\(STLA\)|\(NTSTLA\)$/.test(li.description) && !/^FL Sales Tax \(/.test(li.description) && li.description !== 'Card Processing Fee (3%)')
        const laborLineItems = (lineItems || []).filter(li => /\((STLA|NTSTLA)\)$/.test(li.description))
        const otherLineItems = (lineItems || []).filter(li => /^FL Sales Tax \(/.test(li.description) || li.description === 'Card Processing Fee (3%)')
        const pdfBuffer = await renderInvoicePdf({
          invoiceNumber: updated.invoice_number,
          invoiceDate: new Date(updated.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
          customer: { name: customer?.name || updated.customer_name || 'Customer', email: customer?.email ?? updated.customer_email ?? null, phone: customer?.phone ?? null, logoUrl: customer?.logo_url ?? null, brandColor: customer?.brand_color ?? null },
          unit: unit ? { model: unit.model, serialNumber: unit.serial_number, equipmentType: unit.equipment_type, nickname: unit.nickname } : null,
          partsLineItems,
          laborLineItems,
          otherLineItems,
          logoUrl: new URL('/images/logo.png', request.url).toString(),
          laborOnlyNote: partsLineItems.length === 0,
          showCardSurchargeDisclosure: otherLineItems.some(li => li.description === 'Card Processing Fee (3%)'),
          notes: updated.notes,
        })
        const fileName = `${updated.id}.pdf`
        const { error: uploadError } = await admin.storage.from('invoices').upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: true })
        if (!uploadError) {
          const { data: { publicUrl } } = admin.storage.from('invoices').getPublicUrl(fileName)
          await admin.from('invoices').update({ pdf_url: publicUrl }).eq('id', updated.id)
          updated.pdf_url = publicUrl
        }
      }

      await logBotAction(admin, { botName, action: 'invoice_patch', endpoint, targetTable: 'invoices', targetId: id, outcome: 'success' })
      return { status: 200, body: { invoice: updated } }
    })

    return NextResponse.json(result.body, { status: result.status, headers: result.replayed ? { 'Idempotent-Replay': 'true' } : undefined })
  })
}

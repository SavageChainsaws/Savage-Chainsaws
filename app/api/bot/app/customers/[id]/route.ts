import { NextRequest, NextResponse } from 'next/server'
import { withBotAuth, jsonError } from '@/lib/bot/respond'
import { withIdempotency, requireIdempotencyKey } from '@/lib/bot/idempotency'
import { logBotAction } from '@/lib/bot/audit'
import { forbiddenCustomerPatchReason, APP_BOT_CUSTOMER_PATCH_FIELDS } from '@/lib/bot/rules'
import { normalizeEmail } from '@/lib/text'

const CUSTOMER_COLUMNS = 'id, name, email, phone, address, business_name, notes, created_by_bot_name'

// Updates only the fields in APP_BOT_CUSTOMER_PATCH_FIELDS (contact info -
// never `name`, never anything admin-managed) on a customer App Bot itself
// created - gated by customers.created_by_bot_name = 'app_bot', a hard 403
// on anything else, including a customer Jesse entered by hand or one that
// already has a portal login attached. There is no DELETE here or
// anywhere in App Bot's customer routes. Every change is audited with both
// the before and after value of each field actually touched.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const endpoint = `PATCH /api/bot/app/customers/${id}`
  return withBotAuth(request, 'app_bot', endpoint, async ({ admin, botName }) => {
    const idempotencyKey = requireIdempotencyKey(request)
    if (!idempotencyKey) return jsonError(400, 'Missing required Idempotency-Key header.')

    const result = await withIdempotency(admin, { botName, endpoint, idempotencyKey }, async () => {
      const { data: existing } = await admin.from('customers').select(CUSTOMER_COLUMNS).eq('id', id).maybeSingle()
      if (!existing) return { status: 404, body: { error: 'Customer not found.' } }

      if (existing.created_by_bot_name !== 'app_bot') {
        await logBotAction(admin, { botName, action: 'customer_patch', endpoint, targetTable: 'customers', targetId: id, outcome: 'denied', detail: { reason: 'not_created_by_app_bot' } })
        return { status: 403, body: { error: 'Forbidden: this customer was not created by App Bot.' } }
      }

      const body = await request.json().catch(() => ({}))
      const forbidden = forbiddenCustomerPatchReason(body)
      if (forbidden) {
        await logBotAction(admin, { botName, action: 'customer_patch', endpoint, targetTable: 'customers', targetId: id, outcome: 'denied', detail: { reason: forbidden } })
        return { status: 403, body: { error: `Forbidden: ${forbidden}` } }
      }

      const update: Record<string, unknown> = {}
      for (const field of APP_BOT_CUSTOMER_PATCH_FIELDS) {
        if (!(field in body)) continue
        if (field === 'email') {
          update.email = body.email ? normalizeEmail(String(body.email).trim()) : null
        } else {
          update[field] = body[field] === null ? null : String(body[field]).trim() || null
        }
      }

      if (Object.keys(update).length === 0) {
        return { status: 400, body: { error: 'No recognized fields to update.' } }
      }

      const { data: updated, error } = await admin.from('customers').update(update).eq('id', id).select(CUSTOMER_COLUMNS).maybeSingle()
      if (error) {
        // 23505 = unique_violation on customers_lower_email_key - this
        // email already belongs to a different customer. Unlike creation,
        // there is no benign "race winner" read here - this customer was
        // already a specific row being edited, so a conflict against some
        // other row is a real conflict, reported as one.
        if (error.code === '23505') {
          await logBotAction(admin, { botName, action: 'customer_patch', endpoint, targetTable: 'customers', targetId: id, outcome: 'denied', detail: { reason: 'email_already_in_use' } })
          return { status: 409, body: { error: 'That email is already in use by a different customer.' } }
        }
        await logBotAction(admin, { botName, action: 'customer_patch', endpoint, targetTable: 'customers', targetId: id, outcome: 'error', detail: { message: error.message } })
        return { status: 500, body: { error: error.message } }
      }
      if (!updated) return { status: 404, body: { error: 'Customer not found.' } }

      const before: Record<string, unknown> = {}
      const after: Record<string, unknown> = {}
      for (const field of Object.keys(update)) {
        before[field] = (existing as Record<string, unknown>)[field]
        after[field] = (updated as Record<string, unknown>)[field]
      }
      await logBotAction(admin, { botName, action: 'customer_patch', endpoint, targetTable: 'customers', targetId: id, outcome: 'success', detail: { before, after } })
      return {
        status: 200,
        body: { customer: { id: updated.id, name: updated.name, email: updated.email, phone: updated.phone, address: updated.address, business_name: updated.business_name, notes: updated.notes } },
      }
    })

    return NextResponse.json(result.body, { status: result.status, headers: result.replayed ? { 'Idempotent-Replay': 'true' } : undefined })
  })
}

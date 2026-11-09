import { NextRequest, NextResponse } from 'next/server'
import { withBotAuth, jsonError } from '@/lib/bot/respond'
import { withIdempotency, requireIdempotencyKey } from '@/lib/bot/idempotency'
import { logBotAction } from '@/lib/bot/audit'
import { forbiddenUnitPatchReason, customerExists, UNIT_BOT_PATCH_FIELDS } from '@/lib/bot/rules'
import { toTitleCase } from '@/lib/text'

// Updates only the fields in UNIT_BOT_PATCH_FIELDS - anything else in the
// body is rejected outright (forbiddenUnitPatchReason), not silently
// ignored. There is no delete here or anywhere in Unit Bot's routes -
// "removing" a unit is archiving it (units.archived), a normal field
// update like any other, never a DELETE. customer_id may only be
// reassigned to a customer confirmed to already exist (customerExists) -
// Unit Bot never creates a customer as a side effect of a unit update.
// Every change is audited with both the before and after value of each
// field actually touched.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const endpoint = `PATCH /api/bot/unit/units/${id}`
  return withBotAuth(request, 'unit_bot', endpoint, async ({ admin, botName }) => {
    const idempotencyKey = requireIdempotencyKey(request)
    if (!idempotencyKey) return jsonError(400, 'Missing required Idempotency-Key header.')

    const result = await withIdempotency(admin, { botName, endpoint, idempotencyKey }, async () => {
      const { data: existing } = await admin.from('units').select('*').eq('id', id).maybeSingle()
      if (!existing) return { status: 404, body: { error: 'Unit not found.' } }

      const body = await request.json().catch(() => ({}))
      const forbidden = forbiddenUnitPatchReason(body)
      if (forbidden) {
        await logBotAction(admin, { botName, action: 'unit_patch', endpoint, targetTable: 'units', targetId: id, outcome: 'denied', detail: { reason: forbidden } })
        return { status: 403, body: { error: `Forbidden: ${forbidden}` } }
      }

      const update: Record<string, unknown> = {}
      for (const field of UNIT_BOT_PATCH_FIELDS) {
        if (!(field in body)) continue
        if (field === 'customer_id') {
          const newCustomerId = (body.customer_id || '').trim()
          if (!newCustomerId) return { status: 400, body: { error: 'customer_id cannot be blank.' } }
          if (!(await customerExists(admin, newCustomerId))) {
            return { status: 404, body: { error: 'customer_id does not match an existing customer.' } }
          }
          update.customer_id = newCustomerId
        } else if (field === 'model') {
          update.model = body.model ? toTitleCase(String(body.model).trim()) : null
        } else {
          update[field] = body[field] === null ? null : String(body[field]).trim() || null
        }
      }

      if (Object.keys(update).length === 0) {
        return { status: 400, body: { error: 'No recognized fields to update.' } }
      }

      const { data: updated, error } = await admin.from('units').update(update).eq('id', id).select('*').maybeSingle()
      if (error) {
        // 23505 = unique_violation on units_customer_identifying_serial_key -
        // this serial is already in use by a DIFFERENT unit for this same
        // customer. Unlike unit creation, there is no benign "race winner"
        // interpretation here - this unit was already a specific row being
        // edited, so a conflict against some other row is a real conflict,
        // reported as one rather than silently returned as if it were the
        // intended result.
        if (error.code === '23505') {
          await logBotAction(admin, { botName, action: 'unit_patch', endpoint, targetTable: 'units', targetId: id, outcome: 'denied', detail: { reason: 'serial_already_in_use_for_customer' } })
          return { status: 409, body: { error: 'That serial number is already on file for a different unit belonging to this customer.' } }
        }
        await logBotAction(admin, { botName, action: 'unit_patch', endpoint, targetTable: 'units', targetId: id, outcome: 'error', detail: { message: error.message } })
        return { status: 500, body: { error: error.message } }
      }
      if (!updated) return { status: 404, body: { error: 'Unit not found.' } }

      const before: Record<string, unknown> = {}
      const after: Record<string, unknown> = {}
      for (const field of Object.keys(update)) {
        before[field] = (existing as Record<string, unknown>)[field]
        after[field] = (updated as Record<string, unknown>)[field]
      }
      await logBotAction(admin, { botName, action: 'unit_patch', endpoint, targetTable: 'units', targetId: id, outcome: 'success', detail: { before, after } })
      return { status: 200, body: { unit: updated } }
    })

    return NextResponse.json(result.body, { status: result.status, headers: result.replayed ? { 'Idempotent-Replay': 'true' } : undefined })
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { withBotAuth, jsonError } from '@/lib/bot/respond'
import { withIdempotency, requireIdempotencyKey } from '@/lib/bot/idempotency'
import { logBotAction } from '@/lib/bot/audit'

const EDITABLE_FIELDS = ['service_date', 'description', 'hour_meter', 'parts_used', 'cost'] as const

// Unit Bot may only edit a service_history entry it ITSELF created
// (created_by_bot_name = 'unit_bot', stamped at creation - see
// POST /api/bot/unit/service-history) - never an admin-entered row, and
// never one App Bot wrote. Enforced both in the initial read-check AND in
// the UPDATE's own .eq('created_by_bot_name', 'unit_bot') filter, so a
// race between the two can't let an edit through that the check above
// would have blocked.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const endpoint = `PATCH /api/bot/unit/service-history/${id}`
  return withBotAuth(request, 'unit_bot', endpoint, async ({ admin, botName }) => {
    const idempotencyKey = requireIdempotencyKey(request)
    if (!idempotencyKey) return jsonError(400, 'Missing required Idempotency-Key header.')

    const result = await withIdempotency(admin, { botName, endpoint, idempotencyKey }, async () => {
      const { data: existing } = await admin.from('service_history').select('*').eq('id', id).maybeSingle()
      if (!existing) return { status: 404, body: { error: 'Service record not found.' } }
      if (existing.created_by_bot_name !== 'unit_bot') {
        await logBotAction(admin, { botName, action: 'service_record_patch', endpoint, targetTable: 'service_history', targetId: id, outcome: 'denied', detail: { reason: 'not_created_by_unit_bot' } })
        return { status: 403, body: { error: 'Unit Bot may only edit a service record it created itself.' } }
      }

      const body = await request.json().catch(() => ({}))
      const badKey = Object.keys(body).find(key => !(EDITABLE_FIELDS as readonly string[]).includes(key))
      if (badKey) {
        await logBotAction(admin, { botName, action: 'service_record_patch', endpoint, targetTable: 'service_history', targetId: id, outcome: 'denied', detail: { reason: `cannot_set_field_${badKey}` } })
        return { status: 403, body: { error: `Forbidden: cannot set field ${badKey}` } }
      }

      const update: Record<string, unknown> = {}
      if ('service_date' in body) update.service_date = (body.service_date || '').trim() || null
      if ('description' in body) update.description = (body.description || '').trim()
      if ('hour_meter' in body) update.hour_meter = body.hour_meter != null ? String(body.hour_meter).trim() || null : null
      if ('parts_used' in body) update.parts_used = Array.isArray(body.parts_used) ? body.parts_used : null
      if ('cost' in body) update.cost = body.cost != null && body.cost !== '' ? Number(body.cost) : null

      if (Object.keys(update).length === 0) {
        return { status: 400, body: { error: 'No recognized fields to update.' } }
      }

      const { data: updated, error } = await admin
        .from('service_history')
        .update(update)
        .eq('id', id)
        .eq('created_by_bot_name', 'unit_bot')
        .select('*')
        .maybeSingle()
      if (error) {
        await logBotAction(admin, { botName, action: 'service_record_patch', endpoint, targetTable: 'service_history', targetId: id, outcome: 'error', detail: { message: error.message } })
        return { status: 500, body: { error: error.message } }
      }
      if (!updated) {
        await logBotAction(admin, { botName, action: 'service_record_patch', endpoint, targetTable: 'service_history', targetId: id, outcome: 'denied', detail: { reason: 'not_created_by_unit_bot_race' } })
        return { status: 403, body: { error: 'Unit Bot may only edit a service record it created itself.' } }
      }

      const before: Record<string, unknown> = {}
      const after: Record<string, unknown> = {}
      for (const field of Object.keys(update)) {
        before[field] = (existing as Record<string, unknown>)[field]
        after[field] = (updated as Record<string, unknown>)[field]
      }
      await logBotAction(admin, { botName, action: 'service_record_patch', endpoint, targetTable: 'service_history', targetId: id, outcome: 'success', detail: { before, after } })
      return { status: 200, body: { service_record: updated } }
    })

    return NextResponse.json(result.body, { status: result.status, headers: result.replayed ? { 'Idempotent-Replay': 'true' } : undefined })
  })
}

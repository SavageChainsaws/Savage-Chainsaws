import { NextRequest, NextResponse } from 'next/server'
import { withBotAuth, jsonError } from '@/lib/bot/respond'
import { withIdempotency, requireIdempotencyKey } from '@/lib/bot/idempotency'
import { logBotAction } from '@/lib/bot/audit'

const ENDPOINT = 'POST /api/bot/unit/service-history'

export async function GET(request: NextRequest) {
  return withBotAuth(request, 'unit_bot', 'GET /api/bot/unit/service-history', async ({ admin, botName }) => {
    const { searchParams } = request.nextUrl
    const unitId = searchParams.get('unit_id')
    let query = admin.from('service_history').select('*').order('service_date', { ascending: false }).limit(200)
    if (unitId) query = query.eq('unit_id', unitId)
    const { data, error } = await query
    if (error) return jsonError(500, error.message)
    await logBotAction(admin, { botName, action: 'service_history_read', endpoint: 'GET /api/bot/unit/service-history', outcome: 'success', detail: { count: data?.length ?? 0 } })
    return NextResponse.json({ service_history: data || [] })
  })
}

// Only ever adds a record to a unit that already exists, confirmed by
// unit_id - never creates a unit itself (use POST /api/bot/unit/units for
// that, with its own dedup check). Stamps created_by_bot_name so the
// PATCH route can later tell "Unit Bot wrote this" apart from an admin-
// entered row or an App Bot one - Unit Bot may only ever edit an entry it
// itself created. hour_meter here is the equipment's running-hours meter
// reading for THIS visit, never labor/time-worked - no labor-hours field
// exists or should be inferred from it. When this entry's hour_meter or
// service_date is newer than what's already on the unit record, the unit
// itself (hour_meter / last_service_date) is bumped to match - the exact
// same "keep the unit's own latest-reading field current" relationship
// documented in the original bot-access migration.
export async function POST(request: NextRequest) {
  return withBotAuth(request, 'unit_bot', ENDPOINT, async ({ admin, botName }) => {
    const idempotencyKey = requireIdempotencyKey(request)
    if (!idempotencyKey) return jsonError(400, 'Missing required Idempotency-Key header.')

    const result = await withIdempotency(admin, { botName, endpoint: ENDPOINT, idempotencyKey }, async () => {
      const body = await request.json().catch(() => ({}))
      const unitId = (body.unit_id || '').trim()
      const description = (body.description || '').trim()
      const serviceDate = (body.service_date || '').trim() || new Date().toISOString().slice(0, 10)
      const hourMeter = body.hour_meter != null ? String(body.hour_meter).trim() || null : null
      const partsUsed = Array.isArray(body.parts_used) ? body.parts_used : null
      const cost = body.cost != null && body.cost !== '' ? Number(body.cost) : null

      if (!unitId || !description) {
        return { status: 400, body: { error: 'unit_id and description are required.' } }
      }

      const { data: unit } = await admin.from('units').select('id, hour_meter, last_service_date').eq('id', unitId).maybeSingle()
      if (!unit) return { status: 404, body: { error: 'unit_id does not match an existing unit.' } }

      const { data: created, error } = await admin
        .from('service_history')
        .insert({ unit_id: unitId, service_date: serviceDate, description, cost, hour_meter: hourMeter, parts_used: partsUsed, created_by_bot_name: botName })
        .select('*')
        .single()
      if (error) {
        await logBotAction(admin, { botName, action: 'service_record_create', endpoint: ENDPOINT, outcome: 'error', detail: { message: error.message } })
        return { status: 500, body: { error: error.message } }
      }

      const unitUpdate: Record<string, unknown> = {}
      const newHourMeterNum = hourMeter != null ? Number(hourMeter) : NaN
      const currentHourMeterNum = unit.hour_meter != null ? Number(unit.hour_meter) : NaN
      if (Number.isFinite(newHourMeterNum) && (!Number.isFinite(currentHourMeterNum) || newHourMeterNum > currentHourMeterNum)) {
        unitUpdate.hour_meter = hourMeter
      }
      if (!unit.last_service_date || serviceDate > unit.last_service_date) {
        unitUpdate.last_service_date = serviceDate
      }
      let unitUpdateAudit: { before: Record<string, unknown>; after: Record<string, unknown> } | null = null
      if (Object.keys(unitUpdate).length > 0) {
        await admin.from('units').update(unitUpdate).eq('id', unitId)
        // The unit's OWN previous values, not just the new ones being set -
        // without this, "before" was missing from the audit entry entirely
        // and only the new reading was ever recorded.
        const before: Record<string, unknown> = {}
        for (const field of Object.keys(unitUpdate)) {
          before[field] = (unit as Record<string, unknown>)[field]
        }
        unitUpdateAudit = { before, after: unitUpdate }
      }

      await logBotAction(admin, { botName, action: 'service_record_create', endpoint: ENDPOINT, targetTable: 'service_history', targetId: created.id, outcome: 'success', detail: { unit_update: unitUpdateAudit } })
      return { status: 201, body: { service_record: created } }
    })

    return NextResponse.json(result.body, { status: result.status, headers: result.replayed ? { 'Idempotent-Replay': 'true' } : undefined })
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { withBotAuth, jsonError } from '@/lib/bot/respond'
import { withIdempotency, requireIdempotencyKey } from '@/lib/bot/idempotency'
import { logBotAction } from '@/lib/bot/audit'

const ENDPOINT = 'POST /api/bot/app/service-records'

export async function GET(request: NextRequest) {
  return withBotAuth(request, 'app_bot', 'GET /api/bot/app/service-records', async ({ admin, botName }) => {
    const { searchParams } = request.nextUrl
    const unitId = searchParams.get('unit_id')
    let query = admin.from('service_history').select('*').order('service_date', { ascending: false }).limit(200)
    if (unitId) query = query.eq('unit_id', unitId)
    const { data, error } = await query
    if (error) return jsonError(500, error.message)
    await logBotAction(admin, { botName, action: 'service_records_read', endpoint: 'GET /api/bot/app/service-records', outcome: 'success', detail: { count: data?.length ?? 0 } })
    return NextResponse.json({ service_records: data || [] })
  })
}

// Only ever adds a record to a unit that already exists and is confirmed by
// unit_id - this endpoint never creates a unit itself (use
// POST /api/bot/app/units for that, with its own dedup check). hour_meter
// is the equipment's running-hours meter reading for this visit, never
// labor/time-worked - no labor-hours field exists here or should be
// inferred from this one (see the migration's own comment on this column).
export async function POST(request: NextRequest) {
  return withBotAuth(request, 'app_bot', ENDPOINT, async ({ admin, botName }) => {
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

      const { data: unit } = await admin.from('units').select('id').eq('id', unitId).maybeSingle()
      if (!unit) return { status: 404, body: { error: 'unit_id does not match an existing unit.' } }

      const { data: created, error } = await admin
        .from('service_history')
        .insert({ unit_id: unitId, service_date: serviceDate, description, cost, hour_meter: hourMeter, parts_used: partsUsed })
        .select('*')
        .single()
      if (error) {
        await logBotAction(admin, { botName, action: 'service_record_create', endpoint: ENDPOINT, outcome: 'error', detail: { message: error.message } })
        return { status: 500, body: { error: error.message } }
      }
      await logBotAction(admin, { botName, action: 'service_record_create', endpoint: ENDPOINT, targetTable: 'service_history', targetId: created.id, outcome: 'success' })
      return { status: 201, body: { service_record: created } }
    })

    return NextResponse.json(result.body, { status: result.status, headers: result.replayed ? { 'Idempotent-Replay': 'true' } : undefined })
  })
}

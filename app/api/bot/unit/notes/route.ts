import { NextRequest, NextResponse } from 'next/server'
import { withBotAuth, jsonError } from '@/lib/bot/respond'
import { withIdempotency, requireIdempotencyKey } from '@/lib/bot/idempotency'
import { logBotAction } from '@/lib/bot/audit'

const ENDPOINT = 'POST /api/bot/unit/notes'

export async function GET(request: NextRequest) {
  return withBotAuth(request, 'unit_bot', 'GET /api/bot/unit/notes', async ({ admin, botName }) => {
    const unitId = request.nextUrl.searchParams.get('unit_id')
    if (!unitId) return jsonError(400, 'unit_id is required.')
    const { data, error } = await admin.from('unit_customer_notes').select('*').eq('unit_id', unitId).maybeSingle()
    if (error) return jsonError(500, error.message)
    await logBotAction(admin, { botName, action: 'unit_customer_notes_read', endpoint: 'GET /api/bot/unit/notes', outcome: 'success' })
    return NextResponse.json({ unit_customer_notes: data || null })
  })
}

// "Update" unit_customer_notes - in practice an upsert, since the table has
// no row for a unit until the first note is ever set (it has a UNIQUE
// constraint on unit_id, not a row seeded per unit at creation time).
// Logs both the before and after text, same as every other Unit Bot write.
export async function POST(request: NextRequest) {
  return withBotAuth(request, 'unit_bot', ENDPOINT, async ({ admin, botName }) => {
    const idempotencyKey = requireIdempotencyKey(request)
    if (!idempotencyKey) return jsonError(400, 'Missing required Idempotency-Key header.')

    const result = await withIdempotency(admin, { botName, endpoint: ENDPOINT, idempotencyKey }, async () => {
      const body = await request.json().catch(() => ({}))
      const unitId = (body.unit_id || '').trim()
      const notes = (body.notes || '').trim()

      if (!unitId || !notes) return { status: 400, body: { error: 'unit_id and notes are required.' } }

      const { data: unit } = await admin.from('units').select('id').eq('id', unitId).maybeSingle()
      if (!unit) return { status: 404, body: { error: 'unit_id does not match an existing unit.' } }

      const { data: before } = await admin.from('unit_customer_notes').select('*').eq('unit_id', unitId).maybeSingle()

      const { data: after, error } = await admin
        .from('unit_customer_notes')
        .upsert({ unit_id: unitId, notes, updated_at: new Date().toISOString() }, { onConflict: 'unit_id' })
        .select('*')
        .single()
      if (error) {
        await logBotAction(admin, { botName, action: 'unit_customer_notes_upsert', endpoint: ENDPOINT, outcome: 'error', detail: { message: error.message } })
        return { status: 500, body: { error: error.message } }
      }

      await logBotAction(admin, { botName, action: 'unit_customer_notes_upsert', endpoint: ENDPOINT, targetTable: 'unit_customer_notes', targetId: after.id, outcome: 'success', detail: { before: before?.notes ?? null, after: after.notes } })
      return { status: before ? 200 : 201, body: { unit_customer_notes: after } }
    })

    return NextResponse.json(result.body, { status: result.status, headers: result.replayed ? { 'Idempotent-Replay': 'true' } : undefined })
  })
}

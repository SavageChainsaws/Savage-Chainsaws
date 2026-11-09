import { NextRequest, NextResponse } from 'next/server'
import { withBotAuth, jsonError } from '@/lib/bot/respond'
import { withIdempotency, requireIdempotencyKey } from '@/lib/bot/idempotency'
import { logBotAction } from '@/lib/bot/audit'
import { resolveMatch, customerExists } from '@/lib/bot/rules'
import { isIdentifyingSerial, escapeLikePattern } from '@/lib/units'
import { toTitleCase } from '@/lib/text'

const ENDPOINT = 'POST /api/bot/unit/units'

// Unit Bot may read units freely, filtered by customer, serial, model, or
// archived state. Same narrow-by-default convention as every other bot GET
// in this app: no filter at all returns a bounded recent list, not the
// whole table.
export async function GET(request: NextRequest) {
  return withBotAuth(request, 'unit_bot', 'GET /api/bot/unit/units', async ({ admin, botName }) => {
    const { searchParams } = request.nextUrl
    const id = searchParams.get('id')
    const customerId = searchParams.get('customer_id')
    const serial = searchParams.get('serial_number')
    const model = searchParams.get('model')
    const archivedParam = searchParams.get('archived')

    if (id) {
      const { data, error } = await admin.from('units').select('*').eq('id', id).maybeSingle()
      if (error) return jsonError(500, error.message)
      await logBotAction(admin, { botName, action: 'units_read', endpoint: 'GET /api/bot/unit/units', outcome: 'success', detail: { count: data ? 1 : 0 } })
      return NextResponse.json({ units: data ? [data] : [] })
    }

    let query = admin.from('units').select('*').order('created_at', { ascending: false }).limit(200)
    if (customerId) query = query.eq('customer_id', customerId)
    if (serial) query = query.ilike('serial_number', escapeLikePattern(serial))
    if (model) query = query.ilike('model', `%${escapeLikePattern(model)}%`)
    if (archivedParam === 'true') query = query.eq('archived', true)
    else if (archivedParam === 'false') query = query.eq('archived', false)

    const { data, error } = await query
    if (error) return jsonError(500, error.message)
    await logBotAction(admin, { botName, action: 'units_read', endpoint: 'GET /api/bot/unit/units', outcome: 'success', detail: { count: data?.length ?? 0 } })
    return NextResponse.json({ units: data || [] })
  })
}

// Creates a unit only for a customer_id confirmed to already exist - Unit
// Bot never creates a customer as a side effect, same reasoning and same
// dedup convention as App Bot's own units endpoint (resolveMatch(),
// isIdentifyingSerial(), escapeLikePattern() - see lib/units.ts and
// lib/bot/rules.ts): a real, non-placeholder serial already on file for
// that customer is an exact match and is returned instead of creating a
// duplicate; a placeholder serial ("Unknown", "", etc) never counts as a
// match signal.
export async function POST(request: NextRequest) {
  return withBotAuth(request, 'unit_bot', ENDPOINT, async ({ admin, botName }) => {
    const idempotencyKey = requireIdempotencyKey(request)
    if (!idempotencyKey) return jsonError(400, 'Missing required Idempotency-Key header.')

    const result = await withIdempotency(admin, { botName, endpoint: ENDPOINT, idempotencyKey }, async () => {
      const body = await request.json().catch(() => ({}))
      const customerId = (body.customer_id || '').trim()
      const serialRaw = (body.serial_number || '').trim()
      const model = (body.model || '').trim() || null
      const equipmentType = (body.equipment_type || '').trim() || null
      const nickname = (body.nickname || '').trim() || null
      const hourMeter = (body.hour_meter || '').trim() || null
      const fleetNotes = (body.fleet_notes || '').trim() || null
      const purchaseDate = (body.purchase_date || '').trim() || null

      if (!customerId) return { status: 400, body: { error: 'customer_id is required.' } }
      if (!(await customerExists(admin, customerId))) {
        return { status: 404, body: { error: 'customer_id does not match an existing customer.' } }
      }

      let match: ReturnType<typeof resolveMatch> = { confidence: 'none' }
      if (isIdentifyingSerial(serialRaw)) {
        const { data: sameSerial } = await admin
          .from('units')
          .select('id, serial_number')
          .eq('customer_id', customerId)
          .ilike('serial_number', escapeLikePattern(serialRaw))
        match = resolveMatch((sameSerial || []).map(u => ({ id: u.id, label: u.serial_number || '' })), [])
      }

      if (match.confidence === 'exact') {
        await logBotAction(admin, { botName, action: 'unit_match', endpoint: ENDPOINT, targetTable: 'units', targetId: match.id, outcome: 'success', detail: { created: false } })
        const { data: existing } = await admin.from('units').select('*').eq('id', match.id).maybeSingle()
        return { status: 200, body: { unit: existing, created: false } }
      }
      if (match.confidence === 'ambiguous') {
        await logBotAction(admin, { botName, action: 'unit_match', endpoint: ENDPOINT, outcome: 'denied', detail: { reason: 'ambiguous_match', candidates: match.candidates } })
        return { status: 409, body: { error: 'Ambiguous match - needs review before this unit can be created or linked.', candidates: match.candidates } }
      }

      // serial_number is NOT NULL on this table - an empty string (never
      // null) is the existing app-wide convention for "no real serial on
      // file yet" (see app/actions/fleetCheckIn.ts).
      const { data: created, error } = await admin
        .from('units')
        .insert({
          customer_id: customerId,
          serial_number: serialRaw,
          model: model ? toTitleCase(model) : null,
          equipment_type: equipmentType,
          nickname,
          hour_meter: hourMeter,
          fleet_notes: fleetNotes,
          purchase_date: purchaseDate,
          // 'Fleet', not 'Received'/'Diagnosing' - those mean "physically
          // checked in for a repair job right now" (see
          // app/actions/fleetCheckIn.ts's addUnit vs addFleetUnit). A
          // Unit-Bot-created unit is a fleet/record registration, not a
          // shop drop-off.
          status: 'Fleet',
        })
        .select('*')
        .single()
      if (error) {
        // 23505 = unique_violation on units_customer_identifying_serial_key -
        // a concurrent request won the race to create this exact serial for
        // this customer first. Re-select and return that row instead of
        // erroring or creating a duplicate.
        if (error.code === '23505' && isIdentifyingSerial(serialRaw)) {
          const { data: raceWinner } = await admin
            .from('units')
            .select('*')
            .eq('customer_id', customerId)
            .ilike('serial_number', escapeLikePattern(serialRaw))
            .maybeSingle()
          if (raceWinner) {
            await logBotAction(admin, { botName, action: 'unit_match', endpoint: ENDPOINT, targetTable: 'units', targetId: raceWinner.id, outcome: 'success', detail: { created: false, via: 'unique_violation_race' } })
            return { status: 200, body: { unit: raceWinner, created: false } }
          }
        }
        await logBotAction(admin, { botName, action: 'unit_create', endpoint: ENDPOINT, outcome: 'error', detail: { message: error.message } })
        return { status: 500, body: { error: error.message } }
      }
      await logBotAction(admin, { botName, action: 'unit_create', endpoint: ENDPOINT, targetTable: 'units', targetId: created.id, outcome: 'success', detail: { created: true } })
      return { status: 201, body: { unit: created, created: true } }
    })

    return NextResponse.json(result.body, { status: result.status, headers: result.replayed ? { 'Idempotent-Replay': 'true' } : undefined })
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { withBotAuth, jsonError } from '@/lib/bot/respond'
import { withIdempotency, requireIdempotencyKey } from '@/lib/bot/idempotency'
import { logBotAction } from '@/lib/bot/audit'
import { resolveMatch } from '@/lib/bot/rules'
import { isIdentifyingSerial, escapeLikePattern } from '@/lib/units'
import { toTitleCase } from '@/lib/text'

const ENDPOINT = 'POST /api/bot/app/units'

export async function GET(request: NextRequest) {
  return withBotAuth(request, 'app_bot', 'GET /api/bot/app/units', async ({ admin, botName }) => {
    const { searchParams } = request.nextUrl
    const customerId = searchParams.get('customer_id')
    const id = searchParams.get('id')
    const serial = searchParams.get('serial_number')

    let query = admin.from('units').select('*').order('created_at', { ascending: false }).limit(200)
    if (id) query = admin.from('units').select('*').eq('id', id).limit(1)
    else {
      if (customerId) query = query.eq('customer_id', customerId)
      if (serial) query = query.ilike('serial_number', escapeLikePattern(serial))
    }

    const { data, error } = await query
    if (error) return jsonError(500, error.message)
    await logBotAction(admin, { botName, action: 'units_read', endpoint: 'GET /api/bot/app/units', outcome: 'success', detail: { count: data?.length ?? 0 } })
    return NextResponse.json({ units: data || [] })
  })
}

// Creates a unit only for a customer_id that's confirmed to exist. A real
// (non-placeholder) serial already on file for that same customer is an
// exact match - returns the existing unit rather than creating a second
// row for the same piece of equipment. A placeholder serial ("Unknown",
// "n/a", etc, per lib/units.ts's own convention) never counts as a match
// signal, so re-checking in the same unit with a placeholder serial always
// creates a new row rather than silently merging into an unrelated one.
export async function POST(request: NextRequest) {
  return withBotAuth(request, 'app_bot', ENDPOINT, async ({ admin, botName }) => {
    const idempotencyKey = requireIdempotencyKey(request)
    if (!idempotencyKey) return jsonError(400, 'Missing required Idempotency-Key header.')

    const result = await withIdempotency(admin, { botName, endpoint: ENDPOINT, idempotencyKey }, async () => {
      const body = await request.json().catch(() => ({}))
      const customerId = (body.customer_id || '').trim()
      const serialRaw = (body.serial_number || '').trim()
      const model = (body.model || '').trim() || null
      const equipmentType = (body.equipment_type || '').trim() || null
      const nickname = (body.nickname || '').trim() || null

      if (!customerId) return { status: 400, body: { error: 'customer_id is required.' } }

      const { data: customer } = await admin.from('customers').select('id').eq('id', customerId).maybeSingle()
      if (!customer) return { status: 404, body: { error: 'customer_id does not match an existing customer.' } }

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
      // file yet" (see app/actions/fleetCheckIn.ts's addUnit/addFleetUnit),
      // and isIdentifyingSerial() already treats an empty string as
      // non-identifying, same as a placeholder.
      const { data: created, error } = await admin
        .from('units')
        .insert({
          customer_id: customerId,
          serial_number: serialRaw,
          model: model ? toTitleCase(model) : null,
          equipment_type: equipmentType,
          nickname,
          // 'Fleet' (not 'Received'/'Diagnosing' - those mean "physically
          // checked in for a repair job right now", see
          // app/actions/fleetCheckIn.ts's addUnit vs addFleetUnit) - a bot-
          // created unit is a fleet/record registration (e.g. before
          // logging a service record for work done elsewhere), not a shop
          // drop-off, and 'Fleet' is what addFleetUnit itself sets for that
          // exact case. It would otherwise wrongly show up as "currently in
          // for service" on the admin repair queue.
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

import { NextRequest, NextResponse } from 'next/server'
import { withBotAuth, jsonError } from '@/lib/bot/respond'
import { withIdempotency, requireIdempotencyKey } from '@/lib/bot/idempotency'
import { logBotAction } from '@/lib/bot/audit'

const ENDPOINT = 'POST /api/bot/unit/parts/unit-overrides'
const VALID_SKU_TYPES = ['OEM', 'Aftermarket']

// part_name_key mirrors unit_part_overrides' own generated-column
// expression (lower(trim(part_name))) - needed to look up the "before"
// row under the table's own unique index (unit_id, part_name_key), never
// written directly.
function partNameKey(partName: string) {
  return partName.trim().toLowerCase()
}

export async function GET(request: NextRequest) {
  return withBotAuth(request, 'unit_bot', 'GET /api/bot/unit/parts/unit-overrides', async ({ admin, botName }) => {
    const unitId = request.nextUrl.searchParams.get('unit_id')
    if (!unitId) return jsonError(400, 'unit_id is required.')
    const { data, error } = await admin.from('unit_part_overrides').select('*').eq('unit_id', unitId).order('part_name')
    if (error) return jsonError(500, error.message)
    await logBotAction(admin, { botName, action: 'unit_part_overrides_read', endpoint: 'GET /api/bot/unit/parts/unit-overrides', outcome: 'success', detail: { count: data?.length ?? 0 } })
    return NextResponse.json({ unit_part_overrides: data || [] })
  })
}

// Upserts a per-unit part override - a SKU (OEM or Aftermarket) specific
// to one physical unit, overriding whatever model_parts would otherwise
// say for its model, plus an alternate-vendor cross-reference
// (rotary_sku/rotary_oem_ref/alt_vendor/alt_part_number/alt_notes - see
// the migration for why these five live here and not on the abandoned,
// disconnected service_parts_list prototype table). Matches an existing
// row by the table's own unique index (unit_id, part_name_key).
export async function POST(request: NextRequest) {
  return withBotAuth(request, 'unit_bot', ENDPOINT, async ({ admin, botName }) => {
    const idempotencyKey = requireIdempotencyKey(request)
    if (!idempotencyKey) return jsonError(400, 'Missing required Idempotency-Key header.')

    const result = await withIdempotency(admin, { botName, endpoint: ENDPOINT, idempotencyKey }, async () => {
      const body = await request.json().catch(() => ({}))
      const unitId = (body.unit_id || '').trim()
      const partName = (body.part_name || '').trim()
      const sku = (body.sku || '').trim() || null
      const skuType = (body.sku_type || 'OEM').trim()
      const rotarySku = (body.rotary_sku || '').trim() || null
      const rotaryOemRef = (body.rotary_oem_ref || '').trim() || null
      const altVendor = (body.alt_vendor || '').trim() || null
      const altPartNumber = (body.alt_part_number || '').trim() || null
      const altNotes = (body.alt_notes || '').trim() || null

      if (!unitId || !partName) {
        return { status: 400, body: { error: 'unit_id and part_name are required.' } }
      }
      if (!VALID_SKU_TYPES.includes(skuType)) {
        return { status: 400, body: { error: `sku_type must be one of: ${VALID_SKU_TYPES.join(', ')}` } }
      }

      const { data: unit } = await admin.from('units').select('id').eq('id', unitId).maybeSingle()
      if (!unit) return { status: 404, body: { error: 'unit_id does not match an existing unit.' } }

      const { data: before } = await admin
        .from('unit_part_overrides')
        .select('*')
        .eq('unit_id', unitId)
        .eq('part_name_key', partNameKey(partName))
        .maybeSingle()

      const { data: after, error } = await admin
        .from('unit_part_overrides')
        .upsert(
          { unit_id: unitId, part_name: partName, sku, sku_type: skuType, rotary_sku: rotarySku, rotary_oem_ref: rotaryOemRef, alt_vendor: altVendor, alt_part_number: altPartNumber, alt_notes: altNotes },
          { onConflict: 'unit_id,part_name_key' }
        )
        .select('*')
        .single()
      if (error) {
        await logBotAction(admin, { botName, action: 'unit_part_overrides_upsert', endpoint: ENDPOINT, outcome: 'error', detail: { message: error.message } })
        return { status: 500, body: { error: error.message } }
      }

      await logBotAction(admin, { botName, action: 'unit_part_overrides_upsert', endpoint: ENDPOINT, targetTable: 'unit_part_overrides', targetId: after.id, outcome: 'success', detail: { before: before ?? null, after } })
      return { status: before ? 200 : 201, body: { unit_part_override: after, created: !before } }
    })

    return NextResponse.json(result.body, { status: result.status, headers: result.replayed ? { 'Idempotent-Replay': 'true' } : undefined })
  })
}

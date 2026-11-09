import { NextRequest, NextResponse } from 'next/server'
import { withBotAuth, jsonError } from '@/lib/bot/respond'
import { withIdempotency, requireIdempotencyKey } from '@/lib/bot/idempotency'
import { logBotAction } from '@/lib/bot/audit'

const ENDPOINT = 'POST /api/bot/unit/parts/model-parts'
const VALID_SKU_TYPES = ['OEM', 'Aftermarket']

// model_key/part_name_key mirror the table's own generated-column
// expressions exactly (model_parts.model_key = upper(regexp_replace(model,
// '\s+','','g')), .part_name_key = lower(trim(part_name))) - needed here
// purely to look up the "before" row with the same identity the table's
// own unique index uses, not to write them (they're generated, never set
// directly).
function modelKey(model: string) {
  return model.toUpperCase().replace(/\s+/g, '')
}
function partNameKey(partName: string) {
  return partName.trim().toLowerCase()
}

export async function GET(request: NextRequest) {
  return withBotAuth(request, 'unit_bot', 'GET /api/bot/unit/parts/model-parts', async ({ admin, botName }) => {
    const { searchParams } = request.nextUrl
    const model = searchParams.get('model')
    let query = admin.from('model_parts').select('*').order('model').limit(500)
    if (model) query = query.eq('model_key', modelKey(model))
    const { data, error } = await query
    if (error) return jsonError(500, error.message)
    await logBotAction(admin, { botName, action: 'model_parts_read', endpoint: 'GET /api/bot/unit/parts/model-parts', outcome: 'success', detail: { count: data?.length ?? 0 } })
    return NextResponse.json({ model_parts: data || [] })
  })
}

// Upserts a (model, part_name) row - matches an existing one by the
// table's own unique index (model_key, part_name_key) rather than id, so
// the bot never needs to look up an id first just to correct a SKU.
export async function POST(request: NextRequest) {
  return withBotAuth(request, 'unit_bot', ENDPOINT, async ({ admin, botName }) => {
    const idempotencyKey = requireIdempotencyKey(request)
    if (!idempotencyKey) return jsonError(400, 'Missing required Idempotency-Key header.')

    const result = await withIdempotency(admin, { botName, endpoint: ENDPOINT, idempotencyKey }, async () => {
      const body = await request.json().catch(() => ({}))
      const model = (body.model || '').trim()
      const partName = (body.part_name || '').trim()
      const sku = (body.sku || '').trim()
      const skuType = (body.sku_type || 'OEM').trim()

      if (!model || !partName || !sku) {
        return { status: 400, body: { error: 'model, part_name, and sku are required.' } }
      }
      if (!VALID_SKU_TYPES.includes(skuType)) {
        return { status: 400, body: { error: `sku_type must be one of: ${VALID_SKU_TYPES.join(', ')}` } }
      }

      const { data: before } = await admin
        .from('model_parts')
        .select('*')
        .eq('model_key', modelKey(model))
        .eq('part_name_key', partNameKey(partName))
        .maybeSingle()

      const { data: after, error } = await admin
        .from('model_parts')
        .upsert({ model, part_name: partName, sku, sku_type: skuType }, { onConflict: 'model_key,part_name_key' })
        .select('*')
        .single()
      if (error) {
        await logBotAction(admin, { botName, action: 'model_parts_upsert', endpoint: ENDPOINT, outcome: 'error', detail: { message: error.message } })
        return { status: 500, body: { error: error.message } }
      }

      await logBotAction(admin, { botName, action: 'model_parts_upsert', endpoint: ENDPOINT, targetTable: 'model_parts', targetId: after.id, outcome: 'success', detail: { before: before ?? null, after } })
      return { status: before ? 200 : 201, body: { model_part: after, created: !before } }
    })

    return NextResponse.json(result.body, { status: result.status, headers: result.replayed ? { 'Idempotent-Replay': 'true' } : undefined })
  })
}

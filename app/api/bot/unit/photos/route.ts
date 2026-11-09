import { NextRequest, NextResponse } from 'next/server'
import { withBotAuth, jsonError } from '@/lib/bot/respond'
import { withIdempotency, requireIdempotencyKey } from '@/lib/bot/idempotency'
import { logBotAction } from '@/lib/bot/audit'

const ENDPOINT = 'POST /api/bot/unit/photos'
const VALID_MEDIA_TYPES = ['photo', 'video']
const VALID_STAGES = ['checkin', 'diagnosis']

export async function GET(request: NextRequest) {
  return withBotAuth(request, 'unit_bot', 'GET /api/bot/unit/photos', async ({ admin, botName }) => {
    const unitId = request.nextUrl.searchParams.get('unit_id')
    if (!unitId) return jsonError(400, 'unit_id is required.')
    const { data, error } = await admin.from('unit_photos').select('*').eq('unit_id', unitId).order('created_at', { ascending: false })
    if (error) return jsonError(500, error.message)
    await logBotAction(admin, { botName, action: 'unit_photos_read', endpoint: 'GET /api/bot/unit/photos', outcome: 'success', detail: { count: data?.length ?? 0 } })
    return NextResponse.json({ unit_photos: data || [] })
  })
}

// Adds a photo/video reference for an existing unit - the file itself is
// uploaded to Supabase Storage by the caller beforehand; this only records
// the resulting url. Unit Bot never deletes a photo - there is no DELETE
// here or anywhere in Unit Bot's routes.
export async function POST(request: NextRequest) {
  return withBotAuth(request, 'unit_bot', ENDPOINT, async ({ admin, botName }) => {
    const idempotencyKey = requireIdempotencyKey(request)
    if (!idempotencyKey) return jsonError(400, 'Missing required Idempotency-Key header.')

    const result = await withIdempotency(admin, { botName, endpoint: ENDPOINT, idempotencyKey }, async () => {
      const body = await request.json().catch(() => ({}))
      const unitId = (body.unit_id || '').trim()
      const url = (body.url || '').trim()
      const caption = (body.caption || '').trim() || null
      const mediaType = (body.media_type || 'photo').trim()
      const stage = (body.stage || 'diagnosis').trim()

      if (!unitId || !url) return { status: 400, body: { error: 'unit_id and url are required.' } }
      if (!VALID_MEDIA_TYPES.includes(mediaType)) {
        return { status: 400, body: { error: `media_type must be one of: ${VALID_MEDIA_TYPES.join(', ')}` } }
      }
      if (!VALID_STAGES.includes(stage)) {
        return { status: 400, body: { error: `stage must be one of: ${VALID_STAGES.join(', ')}` } }
      }

      const { data: unit } = await admin.from('units').select('id').eq('id', unitId).maybeSingle()
      if (!unit) return { status: 404, body: { error: 'unit_id does not match an existing unit.' } }

      const { data: created, error } = await admin
        .from('unit_photos')
        .insert({ unit_id: unitId, url, caption, media_type: mediaType, stage })
        .select('*')
        .single()
      if (error) {
        await logBotAction(admin, { botName, action: 'unit_photo_create', endpoint: ENDPOINT, outcome: 'error', detail: { message: error.message } })
        return { status: 500, body: { error: error.message } }
      }
      await logBotAction(admin, { botName, action: 'unit_photo_create', endpoint: ENDPOINT, targetTable: 'unit_photos', targetId: created.id, outcome: 'success' })
      return { status: 201, body: { unit_photo: created } }
    })

    return NextResponse.json(result.body, { status: result.status, headers: result.replayed ? { 'Idempotent-Replay': 'true' } : undefined })
  })
}

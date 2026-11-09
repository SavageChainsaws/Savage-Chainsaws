import { NextRequest, NextResponse } from 'next/server'
import { withBotAuth, jsonError } from '@/lib/bot/respond'
import { withIdempotency, requireIdempotencyKey } from '@/lib/bot/idempotency'
import { logBotAction } from '@/lib/bot/audit'
import { resolveMatch } from '@/lib/bot/rules'
import { toTitleCase, normalizeEmail } from '@/lib/text'

const ENDPOINT = 'POST /api/bot/app/customers'

// App Bot may read customers freely. Optional filters narrow the result;
// with none given, returns a bounded recent list rather than the whole
// table, so a bot that forgets a filter doesn't accidentally pull
// everything every time.
export async function GET(request: NextRequest) {
  return withBotAuth(request, 'app_bot', 'GET /api/bot/app/customers', async ({ admin }) => {
    const { searchParams } = request.nextUrl
    const email = searchParams.get('email')
    const q = searchParams.get('q')
    const id = searchParams.get('id')

    let query = admin
      .from('customers')
      .select('id, name, email, secondary_email, phone, referral_source_id, payment_plans_enabled, created_at')
      .order('created_at', { ascending: false })
      .limit(200)

    if (id) query = admin.from('customers').select('*').eq('id', id).limit(1)
    else if (email) query = query.ilike('email', normalizeEmail(email))
    else if (q) query = query.ilike('name', `%${q}%`)

    const { data, error } = await query
    if (error) return jsonError(500, error.message)
    return NextResponse.json({ customers: data || [] })
  })
}

// Creates a customer only when no existing one plausibly matches; returns
// the existing row instead of creating a duplicate when one does. An
// ambiguous match (anything short of a confirmed email match) is never
// auto-linked or auto-created past - it comes back as 409 for Jesse to
// resolve by hand.
export async function POST(request: NextRequest) {
  return withBotAuth(request, 'app_bot', ENDPOINT, async ({ admin, botName }) => {
    const idempotencyKey = requireIdempotencyKey(request)
    if (!idempotencyKey) return jsonError(400, 'Missing required Idempotency-Key header.')

    const result = await withIdempotency(admin, { botName, endpoint: ENDPOINT, idempotencyKey }, async () => {
      const body = await request.json().catch(() => ({}))
      const nameRaw = (body.name || '').trim()
      const emailRaw = (body.email || '').trim()
      const phone = (body.phone || '').trim() || null
      if (!nameRaw) return { status: 400, body: { error: 'name is required.' } }

      const name = toTitleCase(nameRaw)
      const email = emailRaw ? normalizeEmail(emailRaw) : null

      const [byEmail, byName] = await Promise.all([
        email
          ? admin.from('customers').select('id, name').ilike('email', email).then(r => r.data || [])
          : Promise.resolve([]),
        admin.from('customers').select('id, name').ilike('name', name).then(r => r.data || []),
      ])

      const match = resolveMatch(
        byEmail.map(c => ({ id: c.id, label: c.name })),
        byName.map(c => ({ id: c.id, label: c.name }))
      )

      if (match.confidence === 'exact') {
        await logBotAction(admin, { botName, action: 'customer_match', endpoint: ENDPOINT, targetTable: 'customers', targetId: match.id, outcome: 'success', detail: { created: false } })
        const { data: existing } = await admin.from('customers').select('*').eq('id', match.id).maybeSingle()
        return { status: 200, body: { customer: existing, created: false } }
      }
      if (match.confidence === 'ambiguous') {
        await logBotAction(admin, { botName, action: 'customer_match', endpoint: ENDPOINT, outcome: 'denied', detail: { reason: 'ambiguous_match', candidates: match.candidates } })
        return { status: 409, body: { error: 'Ambiguous match - needs review before this customer can be created or linked.', candidates: match.candidates } }
      }

      const { data: created, error } = await admin
        .from('customers')
        .insert({ name, email, phone })
        .select('*')
        .single()
      if (error) {
        await logBotAction(admin, { botName, action: 'customer_create', endpoint: ENDPOINT, outcome: 'error', detail: { message: error.message } })
        return { status: 500, body: { error: error.message } }
      }
      await logBotAction(admin, { botName, action: 'customer_create', endpoint: ENDPOINT, targetTable: 'customers', targetId: created.id, outcome: 'success', detail: { created: true } })
      return { status: 201, body: { customer: created, created: true } }
    })

    return NextResponse.json(result.body, { status: result.status, headers: result.replayed ? { 'Idempotent-Replay': 'true' } : undefined })
  })
}

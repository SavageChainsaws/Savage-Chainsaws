import { NextRequest, NextResponse } from 'next/server'
import { withBotAuth, jsonError } from '@/lib/bot/respond'
import { withIdempotency, requireIdempotencyKey } from '@/lib/bot/idempotency'
import { logBotAction } from '@/lib/bot/audit'
import { resolveMatch } from '@/lib/bot/rules'
import { toTitleCase, normalizeEmail } from '@/lib/text'
import { escapeLikePattern } from '@/lib/units'

const ENDPOINT = 'POST /api/bot/app/customers'
const CUSTOMER_COLUMNS = 'id, name, email, secondary_email, phone, referral_source_id, referral_discount_used, payment_plans_enabled, created_at'

// App Bot may read customers freely. Optional filters narrow the result;
// with none given, returns a bounded recent list rather than the whole
// table, so a bot that forgets a filter doesn't accidentally pull
// everything every time. Always the same narrow column list, even for a
// single-id lookup - select('*') would also hand back auth_user_id,
// logo_url, brand_color etc. that App Bot has no actual use for.
export async function GET(request: NextRequest) {
  return withBotAuth(request, 'app_bot', 'GET /api/bot/app/customers', async ({ admin, botName }) => {
    const { searchParams } = request.nextUrl
    const email = searchParams.get('email')
    const q = searchParams.get('q')
    const id = searchParams.get('id')

    let query = admin.from('customers').select(CUSTOMER_COLUMNS).order('created_at', { ascending: false }).limit(200)

    if (id) {
      const { data, error } = await admin.from('customers').select(CUSTOMER_COLUMNS).eq('id', id).maybeSingle()
      if (error) return jsonError(500, error.message)
      await logBotAction(admin, { botName, action: 'customers_read', endpoint: 'GET /api/bot/app/customers', outcome: 'success', detail: { count: data ? 1 : 0 } })
      return NextResponse.json({ customers: data ? [data] : [] })
    }
    if (email) {
      // ilike treats _ and % as wildcards - escaping makes this an exact,
      // case-insensitive match instead of an accidental pattern search.
      // Two separate queries (never a hand-built .or() string) so a
      // caller-supplied email can't inject extra filter clauses - checks
      // secondary_email too, not just the primary address.
      const pattern = escapeLikePattern(normalizeEmail(email))
      const [byPrimary, bySecondary] = await Promise.all([
        admin.from('customers').select(CUSTOMER_COLUMNS).ilike('email', pattern).limit(50),
        admin.from('customers').select(CUSTOMER_COLUMNS).ilike('secondary_email', pattern).limit(50),
      ])
      if (byPrimary.error) return jsonError(500, byPrimary.error.message)
      if (bySecondary.error) return jsonError(500, bySecondary.error.message)
      const seen = new Set<string>()
      const merged = [...(byPrimary.data || []), ...(bySecondary.data || [])].filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)))
      await logBotAction(admin, { botName, action: 'customers_read', endpoint: 'GET /api/bot/app/customers', outcome: 'success', detail: { count: merged.length } })
      return NextResponse.json({ customers: merged })
    }
    if (q) query = query.ilike('name', `%${escapeLikePattern(q)}%`)

    const { data, error } = await query
    if (error) return jsonError(500, error.message)
    await logBotAction(admin, { botName, action: 'customers_read', endpoint: 'GET /api/bot/app/customers', outcome: 'success', detail: { count: data?.length ?? 0 } })
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

      const emailPattern = email ? escapeLikePattern(email) : null
      const [byPrimaryEmail, bySecondaryEmail, byName] = await Promise.all([
        emailPattern
          ? admin.from('customers').select('id, name').ilike('email', emailPattern).then(r => r.data || [])
          : Promise.resolve([]),
        emailPattern
          ? admin.from('customers').select('id, name').ilike('secondary_email', emailPattern).then(r => r.data || [])
          : Promise.resolve([]),
        admin.from('customers').select('id, name').ilike('name', escapeLikePattern(name)).then(r => r.data || []),
      ])
      const seenEmailMatch = new Set<string>()
      const byEmail = [...byPrimaryEmail, ...bySecondaryEmail].filter(c => (seenEmailMatch.has(c.id) ? false : (seenEmailMatch.add(c.id), true)))

      const match = resolveMatch(
        byEmail.map(c => ({ id: c.id, label: c.name })),
        byName.map(c => ({ id: c.id, label: c.name }))
      )

      if (match.confidence === 'exact') {
        await logBotAction(admin, { botName, action: 'customer_match', endpoint: ENDPOINT, targetTable: 'customers', targetId: match.id, outcome: 'success', detail: { created: false } })
        const { data: existing } = await admin.from('customers').select(CUSTOMER_COLUMNS).eq('id', match.id).maybeSingle()
        return { status: 200, body: { customer: existing, created: false } }
      }
      if (match.confidence === 'ambiguous') {
        await logBotAction(admin, { botName, action: 'customer_match', endpoint: ENDPOINT, outcome: 'denied', detail: { reason: 'ambiguous_match', candidates: match.candidates } })
        return { status: 409, body: { error: 'Ambiguous match - needs review before this customer can be created or linked.', candidates: match.candidates } }
      }

      const { data: created, error } = await admin
        .from('customers')
        .insert({ name, email, phone })
        .select(CUSTOMER_COLUMNS)
        .single()
      if (error) {
        // 23505 = unique_violation - a concurrent request (or a match our
        // own ilike-based lookup above missed, e.g. differing only in a
        // trailing space normalizeEmail doesn't strip) won the race to
        // create this same email first. Treat it as a found match rather
        // than an error: re-select and return the row that's actually
        // there instead of creating a duplicate or failing the request.
        if (error.code === '23505' && email) {
          const { data: raceWinner } = await admin
            .from('customers')
            .select(CUSTOMER_COLUMNS)
            .ilike('email', escapeLikePattern(email))
            .maybeSingle()
          if (raceWinner) {
            await logBotAction(admin, { botName, action: 'customer_match', endpoint: ENDPOINT, targetTable: 'customers', targetId: raceWinner.id, outcome: 'success', detail: { created: false, via: 'unique_violation_race' } })
            return { status: 200, body: { customer: raceWinner, created: false } }
          }
        }
        await logBotAction(admin, { botName, action: 'customer_create', endpoint: ENDPOINT, outcome: 'error', detail: { message: error.message } })
        return { status: 500, body: { error: error.message } }
      }
      await logBotAction(admin, { botName, action: 'customer_create', endpoint: ENDPOINT, targetTable: 'customers', targetId: created.id, outcome: 'success', detail: { created: true } })
      return { status: 201, body: { customer: created, created: true } }
    })

    return NextResponse.json(result.body, { status: result.status, headers: result.replayed ? { 'Idempotent-Replay': 'true' } : undefined })
  })
}

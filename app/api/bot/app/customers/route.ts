import { NextRequest, NextResponse } from 'next/server'
import { withBotAuth, jsonError } from '@/lib/bot/respond'
import { withIdempotency, requireIdempotencyKey } from '@/lib/bot/idempotency'
import { logBotAction } from '@/lib/bot/audit'
import { toTitleCase, normalizeEmail } from '@/lib/text'
import { escapeLikePattern } from '@/lib/units'

const ENDPOINT = 'POST /api/bot/app/customers'
// address/business_name/notes added here alongside the three they were
// added to the table for (see the migration) - a bot that can write them
// via create/PATCH but never read them back through this same route would
// otherwise be a pointless gap. created_by_bot_name is deliberately left
// out - that's internal bookkeeping for the PATCH route's own gate, not
// business data App Bot has any use for.
const CUSTOMER_COLUMNS =
  'id, name, email, secondary_email, phone, address, business_name, notes, referral_source_id, referral_discount_used, payment_plans_enabled, created_at'

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

// Creates a customer, after a literal duplicate-contact-info guard: an
// existing customer with the same email (case-insensitive, same rule the
// customers_lower_email_key index enforces at the DB level) or the same
// phone (compared as typed - no digits-only normalization, matching how
// phone is stored/compared everywhere else in this app, i.e. nowhere else)
// is returned as a 409 instead of creating a second record. Unlike the
// name-similarity "ambiguous match" review flow this endpoint used to have
// (fuzzy name matches, multi-candidate 409s), this is deliberately a
// narrower, literal check - Jesse's spec for this endpoint only ever
// mentioned email/phone, never name, as a duplicate signal. Never creates
// a customer portal login (customer_users), sends a welcome email/SMS, or
// triggers any other notification - this route touches customers and the
// bot-infrastructure tables only; the portal login stays Jesse's own,
// separate step through the admin UI.
export async function POST(request: NextRequest) {
  return withBotAuth(request, 'app_bot', ENDPOINT, async ({ admin, botName }) => {
    const idempotencyKey = requireIdempotencyKey(request)
    if (!idempotencyKey) return jsonError(400, 'Missing required Idempotency-Key header.')

    const result = await withIdempotency(admin, { botName, endpoint: ENDPOINT, idempotencyKey }, async () => {
      const body = await request.json().catch(() => ({}))
      const nameRaw = (body.name || '').trim()
      if (!nameRaw) return { status: 400, body: { error: 'name is required.' } }
      const name = toTitleCase(nameRaw)

      const emailRaw = (body.email || '').trim()
      const email = emailRaw ? normalizeEmail(emailRaw) : null
      const phone = (body.phone || '').trim() || null
      const address = (body.address || '').trim() || null
      const businessName = (body.business_name || '').trim() || null
      const notes = (body.notes || '').trim() || null

      const [byEmail, byPhone] = await Promise.all([
        email
          ? admin.from('customers').select('id, name').ilike('email', escapeLikePattern(email)).limit(1).then(r => r.data || [])
          : Promise.resolve([]),
        phone
          ? admin.from('customers').select('id, name').eq('phone', phone).limit(1).then(r => r.data || [])
          : Promise.resolve([]),
      ])
      const duplicate = byEmail[0] || byPhone[0]
      if (duplicate) {
        await logBotAction(admin, { botName, action: 'customer_create', endpoint: ENDPOINT, targetTable: 'customers', targetId: duplicate.id, outcome: 'denied', detail: { reason: 'duplicate_email_or_phone' } })
        return { status: 409, body: { error: 'A customer with this email or phone already exists.', customer: { id: duplicate.id, name: duplicate.name } } }
      }

      const { data: created, error } = await admin
        .from('customers')
        .insert({ name, email, phone, address, business_name: businessName, notes, created_by_bot_name: botName })
        .select('id, name, email, phone, address, business_name, notes, created_at')
        .single()
      if (error) {
        // 23505 = unique_violation on customers_lower_email_key - a
        // concurrent request won the race to create this exact email
        // first (our own lookup above missed it only because it ran a
        // moment too early). Treat it as the duplicate it actually is:
        // return the row that's really there as a 409, same shape as the
        // pre-insert duplicate check above, rather than creating a second
        // row or failing the request outright.
        if (error.code === '23505' && email) {
          const { data: raceWinners } = await admin.from('customers').select('id, name').ilike('email', escapeLikePattern(email)).limit(1)
          const raceWinner = (raceWinners || [])[0]
          if (raceWinner) {
            await logBotAction(admin, { botName, action: 'customer_create', endpoint: ENDPOINT, targetTable: 'customers', targetId: raceWinner.id, outcome: 'denied', detail: { reason: 'duplicate_email_or_phone', via: 'unique_violation_race' } })
            return { status: 409, body: { error: 'A customer with this email or phone already exists.', customer: raceWinner } }
          }
        }
        await logBotAction(admin, { botName, action: 'customer_create', endpoint: ENDPOINT, outcome: 'error', detail: { message: error.message } })
        return { status: 500, body: { error: error.message } }
      }
      // The created row (full contact fields) is the audit "after" value -
      // the API response itself stays narrow (id/name only), matching
      // every other bot's "contact info beyond id/name is never handed
      // back more widely than it has to be" convention.
      await logBotAction(admin, { botName, action: 'customer_create', endpoint: ENDPOINT, targetTable: 'customers', targetId: created.id, outcome: 'success', detail: { after: created } })
      return { status: 201, body: { customer: { id: created.id, name: created.name } } }
    })

    return NextResponse.json(result.body, { status: result.status, headers: result.replayed ? { 'Idempotent-Replay': 'true' } : undefined })
  })
}

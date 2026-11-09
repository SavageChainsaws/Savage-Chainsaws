import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'crypto'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

// A minimal fake Supabase admin covering exactly the bot_tokens/bot_audit_log
// chains withBotAuth, verifyBotToken, and checkRateLimit actually call -
// with a real in-memory audit log, so the rate-limit count this test
// exercises is the real counting logic, not a stubbed-out number.
function makeFakeAdmin() {
  const auditRows: { bot_name: string }[] = []
  const tokens = new Map<string, { id: string; bot_name: string; revoked_at: string | null }>()

  const admin = {
    from: vi.fn((table: string) => {
      if (table === 'bot_tokens') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((_col: string, hash: string) => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn(async () => {
                  const row = tokens.get(hash)
                  return { data: row && row.revoked_at === null ? row : null }
                }),
              })),
            })),
          })),
          update: vi.fn(() => ({ eq: vi.fn(async () => ({})) })),
        }
      }
      if (table === 'bot_audit_log') {
        return {
          insert: vi.fn(async (row: { bot_name: string }) => {
            auditRows.push({ bot_name: row.bot_name })
            return { error: null }
          }),
          select: vi.fn(() => ({
            eq: vi.fn((_col: string, botName: string) => ({
              gte: vi.fn(async () => ({ count: auditRows.filter(r => r.bot_name === botName).length })),
            })),
          })),
        }
      }
      throw new Error(`Unexpected table in test fake: ${table}`)
    }),
  }
  return { admin, tokens, auditRows }
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

describe('withBotAuth rate limiting', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  // This is the exact bug the blocker found: a flood of bad-token requests
  // was logged under the real bot_name being targeted, and checkRateLimit
  // counts every bot_audit_log row for that bot_name regardless of
  // outcome - so 120+ invalid requests alone could lock out the real
  // token. Fixed by logging a failed/unauthenticated attempt under
  // ANONYMOUS_BOT_LABEL instead, which never matches any real bot's
  // rate-limit query.
  it('150 bad-token requests do not rate-limit a subsequent valid App Bot token', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { admin, tokens } = makeFakeAdmin()
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin)

    const realToken = 'appbot_real-token-for-this-test'
    tokens.set(hashToken(realToken), { id: 'tok-1', bot_name: 'app_bot', revoked_at: null })

    const { withBotAuth } = await import('./respond')

    for (let i = 0; i < 150; i++) {
      const res = await withBotAuth(
        new Request('http://x', { headers: { authorization: `Bearer bogus-${i}` } }),
        'app_bot',
        'GET /api/bot/app/invoices',
        async () => new Response(null, { status: 200 })
      )
      expect(res.status).toBe(401)
    }

    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    const res = await withBotAuth(
      new Request('http://x', { headers: { authorization: `Bearer ${realToken}` } }),
      'app_bot',
      'GET /api/bot/app/invoices',
      handler
    )

    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('a real bot still gets rate-limited once its OWN logged activity hits the cap - this fix only excludes anonymous/failed-auth noise, not genuine load', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { admin, tokens, auditRows } = makeFakeAdmin()
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin)

    const realToken = 'appbot_another-real-token'
    tokens.set(hashToken(realToken), { id: 'tok-2', bot_name: 'app_bot', revoked_at: null })
    // withBotAuth itself never logs a 'success' row (each route's own
    // handler does, via logBotAction) - simulating 120 already-logged
    // app_bot rows is the realistic stand-in for "this bot has made 120
    // real, successful calls in the last minute" without needing a
    // handler that re-implements every route's own audit call.
    for (let i = 0; i < 120; i++) auditRows.push({ bot_name: 'app_bot' })

    const { withBotAuth } = await import('./respond')
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    const res = await withBotAuth(
      new Request('http://x', { headers: { authorization: `Bearer ${realToken}` } }),
      'app_bot',
      'GET /api/bot/app/invoices',
      handler
    )

    expect(res.status).toBe(429)
    expect(handler).not.toHaveBeenCalled()
  })
})

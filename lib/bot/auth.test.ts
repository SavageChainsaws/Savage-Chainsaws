import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateBotToken } from './auth'

describe('generateBotToken', () => {
  it('prefixes the plaintext token with the bot name so it is recognizable at a glance', () => {
    expect(generateBotToken('app_bot').token.startsWith('appbot_')).toBe(true)
    expect(generateBotToken('financial_bot').token.startsWith('finbot_')).toBe(true)
    expect(generateBotToken('unit_bot').token.startsWith('unitbot_')).toBe(true)
  })

  it('never returns the hash as the token or vice versa', () => {
    const { token, tokenHash } = generateBotToken('app_bot')
    expect(tokenHash).not.toBe(token)
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generates a different token (and hash) every call - no two bots ever share a secret', () => {
    const a = generateBotToken('app_bot')
    const b = generateBotToken('app_bot')
    expect(a.token).not.toBe(b.token)
    expect(a.tokenHash).not.toBe(b.tokenHash)
  })
})

// verifyBotToken needs a database round-trip, so the admin client is
// mocked here rather than hit for real - these tests exercise exactly the
// forbidden-access scenarios the task calls out: a missing token, an
// App Bot token used against a Financial Bot route (and vice versa), and a
// revoked token, none of which should ever authenticate.
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

describe('verifyBotToken', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  async function setup(row: { bot_name: string; revoked_at: string | null } | null) {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    // .is('revoked_at', null) is simulated for real here (not just stubbed
    // through) - a row with revoked_at set comes back as "not found", the
    // same as the real query's filter would do, so a revoked-token test
    // actually exercises that filtering rather than just asserting on a
    // hand-picked null.
    const maybeSingle = vi.fn().mockResolvedValue({ data: row && row.revoked_at === null ? row : null })
    const is = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ is })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select, update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) }) })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({ from })
    const { verifyBotToken } = await import('./auth')
    return verifyBotToken
  }

  it('rejects a request with no Authorization header', async () => {
    const verifyBotToken = await setup(null)
    const result = await verifyBotToken(new Request('http://x'), 'app_bot')
    expect(result).toBeNull()
  })

  it('rejects an unknown token', async () => {
    const verifyBotToken = await setup(null)
    const result = await verifyBotToken(new Request('http://x', { headers: { authorization: 'Bearer bogus' } }), 'app_bot')
    expect(result).toBeNull()
  })

  it('rejects a valid App Bot token presented to a Financial Bot route', async () => {
    const verifyBotToken = await setup({ bot_name: 'app_bot', revoked_at: null })
    const result = await verifyBotToken(new Request('http://x', { headers: { authorization: 'Bearer appbot_x' } }), 'financial_bot')
    expect(result).toBeNull()
  })

  it('accepts a valid token for the exact bot the route requires', async () => {
    const verifyBotToken = await setup({ bot_name: 'app_bot', revoked_at: null })
    const result = await verifyBotToken(new Request('http://x', { headers: { authorization: 'Bearer appbot_x' } }), 'app_bot')
    expect(result?.botName).toBe('app_bot')
  })

  it('rejects a revoked token even though its row still exists', async () => {
    const verifyBotToken = await setup({ bot_name: 'app_bot', revoked_at: '2026-01-01T00:00:00Z' })
    const result = await verifyBotToken(new Request('http://x', { headers: { authorization: 'Bearer appbot_x' } }), 'app_bot')
    expect(result).toBeNull()
  })

  // Unit Bot is a third, equally-isolated scope - none of the three bots'
  // tokens may ever authenticate a route scoped to a different one.
  it('rejects a valid Unit Bot token presented to an App Bot route', async () => {
    const verifyBotToken = await setup({ bot_name: 'unit_bot', revoked_at: null })
    const result = await verifyBotToken(new Request('http://x', { headers: { authorization: 'Bearer unitbot_x' } }), 'app_bot')
    expect(result).toBeNull()
  })

  it('rejects a valid Unit Bot token presented to a Financial Bot route', async () => {
    const verifyBotToken = await setup({ bot_name: 'unit_bot', revoked_at: null })
    const result = await verifyBotToken(new Request('http://x', { headers: { authorization: 'Bearer unitbot_x' } }), 'financial_bot')
    expect(result).toBeNull()
  })

  it('rejects a valid App Bot token presented to a Unit Bot route', async () => {
    const verifyBotToken = await setup({ bot_name: 'app_bot', revoked_at: null })
    const result = await verifyBotToken(new Request('http://x', { headers: { authorization: 'Bearer appbot_x' } }), 'unit_bot')
    expect(result).toBeNull()
  })

  it('rejects a valid Financial Bot token presented to a Unit Bot route', async () => {
    const verifyBotToken = await setup({ bot_name: 'financial_bot', revoked_at: null })
    const result = await verifyBotToken(new Request('http://x', { headers: { authorization: 'Bearer finbot_x' } }), 'unit_bot')
    expect(result).toBeNull()
  })

  it('accepts a valid Unit Bot token for a Unit Bot route', async () => {
    const verifyBotToken = await setup({ bot_name: 'unit_bot', revoked_at: null })
    const result = await verifyBotToken(new Request('http://x', { headers: { authorization: 'Bearer unitbot_x' } }), 'unit_bot')
    expect(result?.botName).toBe('unit_bot')
  })
})

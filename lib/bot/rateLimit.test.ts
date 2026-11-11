import { describe, it, expect, vi } from 'vitest'
import { isRateLimited, checkRateLimit, RATE_LIMIT_MAX_PER_WINDOW } from './rateLimit'

describe('isRateLimited', () => {
  it('allows a count under the limit', () => {
    expect(isRateLimited(RATE_LIMIT_MAX_PER_WINDOW - 1, RATE_LIMIT_MAX_PER_WINDOW)).toBe(false)
  })

  it('blocks a count at the limit - the limit is a hard cap, not a soft one', () => {
    expect(isRateLimited(RATE_LIMIT_MAX_PER_WINDOW, RATE_LIMIT_MAX_PER_WINDOW)).toBe(true)
  })

  it('blocks a count over the limit', () => {
    expect(isRateLimited(RATE_LIMIT_MAX_PER_WINDOW + 1, RATE_LIMIT_MAX_PER_WINDOW)).toBe(true)
  })

  it('allows zero recent calls', () => {
    expect(isRateLimited(0, RATE_LIMIT_MAX_PER_WINDOW)).toBe(false)
  })
})

describe('checkRateLimit', () => {
  // A fake bot_audit_log matching the exact chain checkRateLimit calls -
  // select(...).eq('bot_name', ...).neq('action', 'rate_limit').gte('created_at', ...) -
  // with a real in-memory row count, so excluding action='rate_limit' is
  // exercised by the real query shape, not a stubbed-out number.
  function makeFakeAdmin(rows: { bot_name: string; action: string }[]) {
    return {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn((_col: string, botName: string) => ({
            neq: vi.fn((_col2: string, excludedAction: string) => ({
              gte: vi.fn(async () => ({ count: rows.filter(r => r.bot_name === botName && r.action !== excludedAction).length })),
            })),
          })),
        })),
      })),
    }
  }

  it('does not count rate_limit denial rows toward a bot\'s own limit - a 429 retry must not extend its own lockout', async () => {
    const rows = Array.from({ length: 150 }, () => ({ bot_name: 'app_bot', action: 'rate_limit' }))
    const admin = makeFakeAdmin(rows)
    expect(await checkRateLimit(admin as never, 'app_bot')).toBe(false)
  })

  it('still rate-limits a bot once its own genuine (non-rate_limit) activity hits the cap', async () => {
    const rows = Array.from({ length: RATE_LIMIT_MAX_PER_WINDOW }, () => ({ bot_name: 'app_bot', action: 'customer_create' }))
    const admin = makeFakeAdmin(rows)
    expect(await checkRateLimit(admin as never, 'app_bot')).toBe(true)
  })

  it('a mix of genuine activity and rate_limit noise only counts the genuine part', async () => {
    const rows = [
      ...Array.from({ length: RATE_LIMIT_MAX_PER_WINDOW - 1 }, () => ({ bot_name: 'app_bot', action: 'customer_create' })),
      ...Array.from({ length: 50 }, () => ({ bot_name: 'app_bot', action: 'rate_limit' })),
    ]
    const admin = makeFakeAdmin(rows)
    expect(await checkRateLimit(admin as never, 'app_bot')).toBe(false)
  })
})

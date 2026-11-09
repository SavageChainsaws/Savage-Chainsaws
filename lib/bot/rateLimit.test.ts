import { describe, it, expect } from 'vitest'
import { isRateLimited, RATE_LIMIT_MAX_PER_WINDOW } from './rateLimit'

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

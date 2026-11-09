import { describe, it, expect, vi } from 'vitest'
import { withIdempotency, requireIdempotencyKey } from './idempotency'

// A minimal fake standing in for the real Supabase client - just enough of
// the .from().insert()/.select()/.update()/.delete() chain shape
// withIdempotency actually calls, with an in-memory "table" so claim/
// replay/release behavior can be simulated without a live database.
function makeFakeAdmin() {
  type Row = { response_status: number | null; response_body: unknown }
  let row: Row | null = null
  const admin = {
    from: vi.fn(() => ({
      insert: vi.fn(async () => {
        if (row) return { error: { message: 'duplicate key value violates unique constraint', code: '23505' } }
        row = { response_status: null, response_body: null }
        return { error: null }
      }),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: row })),
            })),
          })),
        })),
      })),
      update: vi.fn((patch: Partial<Row>) => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(async () => {
              if (row) row = { ...row, ...patch }
              return { error: null }
            }),
          })),
        })),
      })),
      delete: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(async () => {
              row = null
              return { error: null }
            }),
          })),
        })),
      })),
    })),
  }
  return { admin, getRow: () => row }
}

describe('requireIdempotencyKey', () => {
  it('rejects a missing header', () => {
    expect(requireIdempotencyKey(new Request('http://x'))).toBeNull()
  })

  it('rejects a blank header', () => {
    expect(requireIdempotencyKey(new Request('http://x', { headers: { 'idempotency-key': '   ' } }))).toBeNull()
  })

  it('accepts and trims a real key', () => {
    expect(requireIdempotencyKey(new Request('http://x', { headers: { 'idempotency-key': ' abc ' } }))).toBe('abc')
  })
})

describe('withIdempotency', () => {
  it('claims the key, runs the action, and stores the result on the first call', async () => {
    const { admin, getRow } = makeFakeAdmin()
    const run = vi.fn().mockResolvedValue({ status: 201, body: { id: 'new-1' } })
    const result = await withIdempotency(admin as never, { botName: 'app_bot', endpoint: 'POST /x', idempotencyKey: 'k1' }, run)
    expect(run).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ status: 201, body: { id: 'new-1' }, replayed: false })
    expect(getRow()).toEqual({ response_status: 201, response_body: { id: 'new-1' } })
  })

  it('a retried request with the same key, after the first finished, replays the stored response without re-running', async () => {
    const { admin, getRow } = makeFakeAdmin()
    const run = vi.fn().mockResolvedValue({ status: 201, body: { id: 'new-1' } })
    await withIdempotency(admin as never, { botName: 'app_bot', endpoint: 'POST /x', idempotencyKey: 'k1' }, run)
    expect(getRow()?.response_status).toBe(201)

    const run2 = vi.fn().mockResolvedValue({ status: 201, body: { id: 'should-never-be-created' } })
    const result = await withIdempotency(admin as never, { botName: 'app_bot', endpoint: 'POST /x', idempotencyKey: 'k1' }, run2)
    expect(run2).not.toHaveBeenCalled()
    expect(result).toEqual({ status: 201, body: { id: 'new-1' }, replayed: true })
  })

  it('a concurrent request with the same key, while the first is still mid-flight, never runs the side effect and gets a 409 instead of a stale/empty replay', async () => {
    const { admin } = makeFakeAdmin()
    // Simulates: this call's own claim attempt loses the insert race to a
    // request that is still running (not yet updated with a result) - the
    // key exists but response_status is still null.
    let insertCount = 0
    admin.from = vi.fn(() => ({
      insert: vi.fn(async () => {
        insertCount++
        return { error: { message: 'duplicate key value violates unique constraint', code: '23505' } }
      }),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: { response_status: null, response_body: null } })),
            })),
          })),
        })),
      })),
    })) as never
    const run = vi.fn()
    const result = await withIdempotency(admin as never, { botName: 'app_bot', endpoint: 'POST /x', idempotencyKey: 'k1' }, run)
    expect(run).not.toHaveBeenCalled()
    expect(insertCount).toBe(1)
    expect(result.status).toBe(409)
    expect(result.replayed).toBe(true)
  })

  it('releases the claim (deletes the row) and does not cache a 5xx result, so a retry can actually re-run', async () => {
    const { admin, getRow } = makeFakeAdmin()
    const run = vi.fn().mockResolvedValue({ status: 502, body: { error: 'upstream down' } })
    const result = await withIdempotency(admin as never, { botName: 'app_bot', endpoint: 'POST /x', idempotencyKey: 'k1' }, run)
    expect(result).toEqual({ status: 502, body: { error: 'upstream down' }, replayed: false })
    expect(getRow()).toBeNull()

    const run2 = vi.fn().mockResolvedValue({ status: 201, body: { id: 'succeeded-on-retry' } })
    const retried = await withIdempotency(admin as never, { botName: 'app_bot', endpoint: 'POST /x', idempotencyKey: 'k1' }, run2)
    expect(run2).toHaveBeenCalledTimes(1)
    expect(retried).toEqual({ status: 201, body: { id: 'succeeded-on-retry' }, replayed: false })
  })

  it('releases the claim if the action throws, so a retry is not permanently blocked', async () => {
    const { admin, getRow } = makeFakeAdmin()
    const run = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(withIdempotency(admin as never, { botName: 'app_bot', endpoint: 'POST /x', idempotencyKey: 'k1' }, run)).rejects.toThrow('boom')
    expect(getRow()).toBeNull()
  })
})

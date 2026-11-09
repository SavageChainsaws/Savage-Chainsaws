import { describe, it, expect, vi } from 'vitest'
import { withIdempotency, requireIdempotencyKey } from './idempotency'

type Row = { response_status: number; response_body: unknown } | null

// A minimal fake standing in for the real Supabase client - just enough of
// the .from().select()... / .insert() chain shape withIdempotency actually
// calls, with an in-memory "table" so a real retried request can be
// simulated without a live database.
function makeFakeAdmin(initial: Row = null) {
  let stored: Row = initial
  let insertShouldConflict = false
  const admin = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: stored })),
            })),
          })),
        })),
      })),
      insert: vi.fn(async (row: { response_status: number; response_body: unknown }) => {
        if (insertShouldConflict || stored) {
          return { error: { message: 'duplicate key value violates unique constraint' } }
        }
        stored = { response_status: row.response_status, response_body: row.response_body }
        return { error: null }
      }),
    })),
  }
  return { admin, forceConflict: (v: boolean) => { insertShouldConflict = v } }
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
  it('runs the action on the first call', async () => {
    const { admin } = makeFakeAdmin()
    const run = vi.fn().mockResolvedValue({ status: 201, body: { id: 'new-1' } })
    const result = await withIdempotency(admin as never, { botName: 'app_bot', endpoint: 'POST /x', idempotencyKey: 'k1' }, run)
    expect(run).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ status: 201, body: { id: 'new-1' }, replayed: false })
  })

  it('a retried request with the same key replays the stored response instead of re-running - never creates a second record', async () => {
    const { admin } = makeFakeAdmin({ response_status: 201, response_body: { id: 'new-1' } })
    const run = vi.fn().mockResolvedValue({ status: 201, body: { id: 'should-never-be-created' } })
    const result = await withIdempotency(admin as never, { botName: 'app_bot', endpoint: 'POST /x', idempotencyKey: 'k1' }, run)
    expect(run).not.toHaveBeenCalled()
    expect(result).toEqual({ status: 201, body: { id: 'new-1' }, replayed: true })
  })

  it('on a concurrent race (two requests, same key, both pass the lookup), the loser defers to whatever the winner stored', async () => {
    // Simulates: this call's own lookup found nothing (so it proceeds to
    // run and insert), but by the time it inserts, a concurrent request
    // with the same key has already won - the insert conflicts, and the
    // re-select after that conflict sees the winner's row.
    let selectCallCount = 0
    const admin = {
      from: vi.fn(() => ({
        select: vi.fn(() => {
          selectCallCount++
          const winnerRow = selectCallCount > 1 ? { response_status: 200, response_body: { id: 'winner' } } : null
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({ data: winnerRow })),
                })),
              })),
            })),
          }
        }),
        insert: vi.fn(async () => ({ error: { message: 'duplicate key value violates unique constraint' } })),
      })),
    }
    const run = vi.fn().mockResolvedValue({ status: 201, body: { id: 'loser-attempt' } })

    const result = await withIdempotency(admin as never, { botName: 'app_bot', endpoint: 'POST /x', idempotencyKey: 'k1' }, run)
    expect(result).toEqual({ status: 200, body: { id: 'winner' }, replayed: true })
  })
})

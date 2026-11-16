import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'crypto'
import type { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

type Row = Record<string, unknown>

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

// ilike is used here only for case-insensitive EXACT matches (no leading/
// trailing % is ever added by the real code), so the fake just does a
// case-insensitive equality check against the already-escaped value - good
// enough for test data that never contains a literal \, %, or _.
function ilikeMatches(value: unknown, pattern: string): boolean {
  return typeof value === 'string' && value.toLowerCase() === pattern.toLowerCase()
}

// A minimal fake Supabase admin covering exactly the bot_tokens/
// bot_audit_log/bot_idempotency_keys/customers chains the real routes call
// - in-memory, not a generic query engine, so each shape below exists only
// because the actual route code under test uses it.
function createFakeAdmin(initialCustomers: Row[] = []) {
  const tokens = new Map<string, { id: string; bot_name: string; revoked_at: string | null }>()
  const auditRows: Row[] = []
  const idempotencyClaims = new Map<string, { response_status: number | null; response_body: unknown; created_at: string }>()
  const customers: Row[] = initialCustomers.map(c => ({ email: null, phone: null, address: null, business_name: null, notes: null, created_by_bot_name: null, ...c }))
  let nextId = 1
  const touched = new Set<string>()

  function customersTable() {
    return {
      select: () => {
        const filters: ((r: Row) => boolean)[] = []
        const api = {
          ilike: (col: string, pattern: string) => {
            filters.push(r => ilikeMatches(r[col], pattern))
            return api
          },
          eq: (col: string, val: unknown) => {
            filters.push(r => r[col] === val)
            return api
          },
          limit: () => Promise.resolve({ data: customers.filter(r => filters.every(f => f(r))), error: null }),
          maybeSingle: async () => {
            const matches = customers.filter(r => filters.every(f => f(r)))
            return { data: matches[0] ?? null, error: null }
          },
        }
        return api
      },
      insert: (row: Row) => ({
        select: () => ({
          single: async () => {
            if (row.email && customers.some(r => typeof r.email === 'string' && (r.email as string).toLowerCase() === (row.email as string).toLowerCase())) {
              return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "customers_lower_email_key"' } }
            }
            const created: Row = { id: `cust-${nextId++}`, created_at: new Date().toISOString(), ...row }
            customers.push(created)
            return { data: created, error: null }
          },
        }),
      }),
      update: (patch: Row) => ({
        eq: (col: string, val: unknown) => ({
          select: () => ({
            maybeSingle: async () => {
              const idx = customers.findIndex(r => r[col] === val)
              if (idx === -1) return { data: null, error: null }
              if (patch.email && customers.some((r, i) => i !== idx && typeof r.email === 'string' && (r.email as string).toLowerCase() === (patch.email as string).toLowerCase())) {
                return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "customers_lower_email_key"' } }
              }
              customers[idx] = { ...customers[idx], ...patch }
              return { data: customers[idx], error: null }
            },
          }),
        }),
      }),
    }
  }

  function idempotencyTable() {
    const keyOf = (botName: string, endpoint: string, idk: string) => `${botName}|${endpoint}|${idk}`
    return {
      insert: (row: Row) => {
        const k = keyOf(row.bot_name as string, row.endpoint as string, row.idempotency_key as string)
        if (idempotencyClaims.has(k)) return Promise.resolve({ error: { code: '23505', message: 'duplicate' } })
        idempotencyClaims.set(k, { response_status: null, response_body: null, created_at: new Date().toISOString() })
        return Promise.resolve({ error: null })
      },
      select: () => ({
        eq: (_c1: string, botName: string) => ({
          eq: (_c2: string, endpoint: string) => ({
            eq: (_c3: string, idk: string) => ({
              maybeSingle: async () => ({ data: idempotencyClaims.get(keyOf(botName, endpoint, idk)) ?? null, error: null }),
            }),
          }),
        }),
      }),
      update: (patch: Row) => ({
        eq: (_c1: string, botName: string) => ({
          eq: (_c2: string, endpoint: string) => ({
            eq: (_c3: string, idk: string) => {
              const k = keyOf(botName, endpoint, idk)
              const existing = idempotencyClaims.get(k)
              if (existing) idempotencyClaims.set(k, { ...existing, ...(patch as object) })
              return Promise.resolve({ error: null })
            },
          }),
        }),
      }),
      delete: () => ({
        eq: (_c1: string, botName: string) => ({
          eq: (_c2: string, endpoint: string) => ({
            eq: (_c3: string, idk: string) => {
              idempotencyClaims.delete(keyOf(botName, endpoint, idk))
              return Promise.resolve({ error: null })
            },
          }),
        }),
      }),
    }
  }

  const admin = {
    from: vi.fn((table: string) => {
      touched.add(table)
      if (table === 'bot_tokens') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((_col: string, hash: string) => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn(async () => {
                  const row = tokens.get(hash)
                  return { data: row && row.revoked_at === null ? row : null, error: null }
                }),
              })),
            })),
          })),
          update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
        }
      }
      if (table === 'bot_audit_log') {
        return {
          insert: vi.fn(async (row: Row) => {
            auditRows.push(row)
            return { error: null }
          }),
          select: vi.fn(() => ({
            eq: vi.fn((_col: string, botName: string) => ({
              neq: vi.fn((_col2: string, excludedAction: string) => ({
                gte: vi.fn(async () => ({ count: auditRows.filter(r => r.bot_name === botName && r.action !== excludedAction).length })),
              })),
            })),
          })),
        }
      }
      if (table === 'bot_idempotency_keys') return idempotencyTable()
      if (table === 'customers') return customersTable()
      throw new Error(`Unexpected table in test fake: ${table}`)
    }),
  }

  return { admin, tokens, auditRows, customers, touched }
}

async function setupTokens(tokens: Map<string, { id: string; bot_name: string; revoked_at: string | null }>) {
  const appBotToken = 'appbot_test-token'
  const unitBotToken = 'unitbot_test-token'
  tokens.set(hashToken(appBotToken), { id: 'tok-app', bot_name: 'app_bot', revoked_at: null })
  tokens.set(hashToken(unitBotToken), { id: 'tok-unit', bot_name: 'unit_bot', revoked_at: null })
  return { appBotToken, unitBotToken }
}

function postRequest(body: unknown, token: string, idempotencyKey: string): NextRequest {
  return new Request('http://x/api/bot/app/customers', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': idempotencyKey },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

describe('POST /api/bot/app/customers', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('creates a customer and returns only its id and name', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { admin, tokens } = createFakeAdmin()
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin)
    const { appBotToken } = await setupTokens(tokens)

    const { POST } = await import('./route')
    const res = await POST(postRequest({ name: 'jane doe', email: 'jane@example.com', phone: '555-1234', address: '1 Main St', business_name: "Jane's Shop", notes: 'VIP' }, appBotToken, 'create-1'))

    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.customer).toEqual({ id: expect.any(String), name: 'Jane Doe' })
  })

  it('returns 409 with the existing customer when the email already matches - no second record is created', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { admin, tokens, customers } = createFakeAdmin([{ id: 'cust-9', name: 'Existing Customer', email: 'dup@example.com' }])
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin)
    const { appBotToken } = await setupTokens(tokens)

    const { POST } = await import('./route')
    const res = await POST(postRequest({ name: 'New Name', email: 'DUP@example.com' }, appBotToken, 'create-2'))

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.customer).toEqual({ id: 'cust-9', name: 'Existing Customer' })
    expect(customers).toHaveLength(1)
  })

  it('returns 409 with the existing customer when the phone already matches - no second record is created', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { admin, tokens, customers } = createFakeAdmin([{ id: 'cust-8', name: 'Phone Match', phone: '555-9999' }])
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin)
    const { appBotToken } = await setupTokens(tokens)

    const { POST } = await import('./route')
    const res = await POST(postRequest({ name: 'New Name', phone: '555-9999' }, appBotToken, 'create-3'))

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.customer).toEqual({ id: 'cust-8', name: 'Phone Match' })
    expect(customers).toHaveLength(1)
  })

  // There is no code path in this route (or anywhere it calls into) that
  // writes a customer_users row, sends an email, or sends an SMS - the
  // concrete, checkable form of that is that customer creation never
  // touches any table beyond customers and the shared bot-infrastructure
  // ones. A portal login (customer_users) staying Jesse's own separate
  // step is the main way that absence could silently regress.
  it('creates the customer without ever touching customer_users or any other table - no portal login, no notification', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { admin, tokens, touched } = createFakeAdmin()
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin)
    const { appBotToken } = await setupTokens(tokens)

    const { POST } = await import('./route')
    const res = await POST(postRequest({ name: 'No Notify' }, appBotToken, 'create-4'))

    expect(res.status).toBe(201)
    expect(touched.has('customer_users')).toBe(false)
    expect([...touched].sort()).toEqual(['bot_audit_log', 'bot_idempotency_keys', 'bot_tokens', 'customers'])
  })

  it('rejects a Unit Bot token - customer creation is App Bot only, Unit Bot stays read-only on customers', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { admin, tokens, customers } = createFakeAdmin()
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin)
    const { unitBotToken } = await setupTokens(tokens)

    const { POST } = await import('./route')
    const res = await POST(postRequest({ name: 'Should Not Create' }, unitBotToken, 'create-5'))

    expect(res.status).toBe(401)
    expect(customers).toHaveLength(0)
  })

  it('has no DELETE handler', async () => {
    const mod: Record<string, unknown> = await import('./route')
    expect(mod.DELETE).toBeUndefined()
  })
})

describe('PATCH /api/bot/app/customers/[id]', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  function patchRequest(body: unknown, token: string, idempotencyKey: string): NextRequest {
    return new Request('http://x', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': idempotencyKey },
      body: JSON.stringify(body),
    }) as unknown as NextRequest
  }

  it('lets App Bot patch contact fields on a customer it created, logging before/after', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { admin, tokens } = createFakeAdmin([{ id: 'cust-1', name: 'Jane Doe', phone: '555-0001', created_by_bot_name: 'app_bot' }])
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin)
    const { appBotToken } = await setupTokens(tokens)

    const { PATCH } = await import('./[id]/route')
    const res = await PATCH(patchRequest({ phone: '555-0002' }, appBotToken, 'patch-1'), { params: Promise.resolve({ id: 'cust-1' }) })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.customer.phone).toBe('555-0002')
  })

  it('rejects patching a customer App Bot did not create (admin-entered, created_by_bot_name is null)', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { admin, tokens } = createFakeAdmin([{ id: 'cust-2', name: 'Admin Made', created_by_bot_name: null }])
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin)
    const { appBotToken } = await setupTokens(tokens)

    const { PATCH } = await import('./[id]/route')
    const res = await PATCH(patchRequest({ phone: '555-0003' }, appBotToken, 'patch-2'), { params: Promise.resolve({ id: 'cust-2' }) })

    expect(res.status).toBe(403)
  })

  it('rejects a field outside the contact allowlist (e.g. name)', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { admin, tokens } = createFakeAdmin([{ id: 'cust-3', name: 'Jane Doe', created_by_bot_name: 'app_bot' }])
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin)
    const { appBotToken } = await setupTokens(tokens)

    const { PATCH } = await import('./[id]/route')
    const res = await PATCH(patchRequest({ name: 'Renamed' }, appBotToken, 'patch-3'), { params: Promise.resolve({ id: 'cust-3' }) })

    expect(res.status).toBe(403)
  })

  it('has no DELETE handler', async () => {
    const mod: Record<string, unknown> = await import('./[id]/route')
    expect(mod.DELETE).toBeUndefined()
  })
})

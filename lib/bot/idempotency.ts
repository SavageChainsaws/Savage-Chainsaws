import type { createAdminClient } from '@/lib/supabase/admin'
import type { BotName } from './auth'

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>

export type IdempotentResult = { status: number; body: unknown; replayed: boolean }

// A claim stuck at response_status = null for longer than this is treated
// as abandoned (the process that claimed it crashed or was killed before
// finalizing or releasing) rather than "still running" - every bot route
// this wraps finishes well within this window under normal operation
// (PDF render + at most one Stripe/Square/Resend call), so a claim still
// unresolved after it is dead, not slow. Without this, a single crash mid-
// request would permanently lock that exact idempotency key out - any
// retry with the same key would get a 409 forever, never actually running.
const STALE_CLAIM_MS = 60_000

type Row = { response_status: number | null; response_body: unknown; created_at: string }

// Claims the (bot, endpoint, idempotency key) BEFORE running the side
// effect, by inserting a placeholder row first - this is what actually
// makes two concurrent requests with the same key safe. (An earlier
// version looked the key up, then ran the side effect, then inserted the
// result - two requests could both pass the lookup and both run the side
// effect before either inserted, defeating the whole point.) Whichever
// request's insert wins the unique-constraint race gets to run; the loser
// either replays the winner's finished response, reclaims an abandoned
// stale one, or - if the winner is still genuinely mid-flight - gets a 409
// telling it to retry shortly, since there is nothing to replay yet.
//
// A run that throws, or returns a 5xx, releases its claim (deletes the
// placeholder row) rather than caching the failure - a transient error
// must be retryable with the same key, not permanently "replayed" as that
// same failure forever.
export async function withIdempotency(
  admin: AdminClient,
  key: { botName: BotName; endpoint: string; idempotencyKey: string },
  run: () => Promise<{ status: number; body: unknown }>
): Promise<IdempotentResult> {
  const claimed = await claimOrInspect(admin, key)
  if (claimed.outcome === 'error') {
    return { status: 500, body: { error: claimed.message }, replayed: false }
  }
  if (claimed.outcome === 'replay') {
    return { status: claimed.row.response_status as number, body: claimed.row.response_body, replayed: true }
  }
  if (claimed.outcome === 'in_progress') {
    return {
      status: 409,
      body: { error: 'A request with this Idempotency-Key is already in progress. Retry shortly.' },
      replayed: true,
    }
  }
  // outcome === 'claimed' - fall through and actually run it.

  let result: { status: number; body: unknown }
  try {
    result = await run()
  } catch (err) {
    await releaseClaim(admin, key)
    throw err
  }

  if (result.status >= 500) {
    await releaseClaim(admin, key)
    return { ...result, replayed: false }
  }

  await admin
    .from('bot_idempotency_keys')
    .update({ response_status: result.status, response_body: result.body as never })
    .eq('bot_name', key.botName)
    .eq('endpoint', key.endpoint)
    .eq('idempotency_key', key.idempotencyKey)

  return { ...result, replayed: false }
}

type ClaimOutcome =
  | { outcome: 'claimed' }
  | { outcome: 'replay'; row: Row }
  | { outcome: 'in_progress' }
  | { outcome: 'error'; message: string }

// Tries to insert the claim row; on a conflict, inspects what's actually
// there and decides what the conflict means - a finished request to
// replay, a genuinely in-flight one to defer to, or a stale/abandoned one
// to reclaim (one retry only, never a loop - if reclaiming itself loses a
// second race, that's a real concurrent in-flight request, not staleness).
async function claimOrInspect(
  admin: AdminClient,
  key: { botName: BotName; endpoint: string; idempotencyKey: string },
  allowReclaim = true
): Promise<ClaimOutcome> {
  const { error: claimError } = await admin.from('bot_idempotency_keys').insert({
    bot_name: key.botName,
    endpoint: key.endpoint,
    idempotency_key: key.idempotencyKey,
  })
  if (!claimError) return { outcome: 'claimed' }

  // Only a unique-constraint conflict on (bot_name, endpoint,
  // idempotency_key) means "already claimed" - any other insert failure
  // (a real DB/connectivity error, a schema problem) is a genuine error
  // and must be reported as one, never mistaken for "someone else has
  // this" and told to retry a request that was never actually running.
  if (claimError.code !== '23505') {
    return { outcome: 'error', message: claimError.message }
  }

  const { data: existing } = await admin
    .from('bot_idempotency_keys')
    .select('response_status, response_body, created_at')
    .eq('bot_name', key.botName)
    .eq('endpoint', key.endpoint)
    .eq('idempotency_key', key.idempotencyKey)
    .maybeSingle()

  if (existing && existing.response_status != null) {
    return { outcome: 'replay', row: existing as Row }
  }

  if (existing && allowReclaim) {
    const ageMs = Date.now() - new Date(existing.created_at).getTime()
    if (ageMs > STALE_CLAIM_MS) {
      // Abandoned - delete it and try claiming exactly once more. If that
      // retry also conflicts, a real concurrent request won it fairly.
      await releaseClaim(admin, key)
      return claimOrInspect(admin, key, false)
    }
  }

  return { outcome: 'in_progress' }
}

async function releaseClaim(admin: AdminClient, key: { botName: BotName; endpoint: string; idempotencyKey: string }) {
  await admin
    .from('bot_idempotency_keys')
    .delete()
    .eq('bot_name', key.botName)
    .eq('endpoint', key.endpoint)
    .eq('idempotency_key', key.idempotencyKey)
}

export function requireIdempotencyKey(request: Request): string | null {
  const key = request.headers.get('idempotency-key')
  return key && key.trim() ? key.trim() : null
}

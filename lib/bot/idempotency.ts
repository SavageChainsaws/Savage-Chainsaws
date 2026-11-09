import type { createAdminClient } from '@/lib/supabase/admin'
import type { BotName } from './auth'

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>

export type IdempotentResult = { status: number; body: unknown; replayed: boolean }

// Claims the (bot, endpoint, idempotency key) BEFORE running the side
// effect, by inserting a placeholder row first - this is what actually
// makes two concurrent requests with the same key safe. (An earlier
// version looked the key up, then ran the side effect, then inserted the
// result - two requests could both pass the lookup and both run the side
// effect before either inserted, defeating the whole point.) Whichever
// request's insert wins the unique-constraint race gets to run; the loser
// either replays the winner's finished response, or - if the winner is
// still mid-flight - gets a 409 telling it to retry shortly, since there
// is nothing to replay yet.
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
  const row = { bot_name: key.botName, endpoint: key.endpoint, idempotency_key: key.idempotencyKey }
  const { error: claimError } = await admin.from('bot_idempotency_keys').insert(row)

  if (claimError) {
    const { data: existing } = await admin
      .from('bot_idempotency_keys')
      .select('response_status, response_body')
      .eq('bot_name', key.botName)
      .eq('endpoint', key.endpoint)
      .eq('idempotency_key', key.idempotencyKey)
      .maybeSingle()
    if (existing && existing.response_status != null) {
      return { status: existing.response_status as number, body: existing.response_body, replayed: true }
    }
    // Claimed by another request that hasn't finished (or crashed without
    // cleaning up) - nothing to replay yet. Never run the side effect here.
    return {
      status: 409,
      body: { error: 'A request with this Idempotency-Key is already in progress. Retry shortly.' },
      replayed: true,
    }
  }

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

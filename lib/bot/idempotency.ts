import type { createAdminClient } from '@/lib/supabase/admin'
import type { BotName } from './auth'

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>

export type IdempotentResult = { status: number; body: unknown; replayed: boolean }

// Runs `run()` at most once per (bot, endpoint, idempotency key) - a retried
// request with the same key replays the first attempt's stored response
// instead of re-executing, so a dropped connection on a bot's side can
// never create a second invoice/service record/customer/unit or send a
// second reminder. Required on every mutating /api/bot/* route; a request
// with no Idempotency-Key header is rejected by the route before this is
// ever called (see requireIdempotencyKey below) - there's no "run without
// protection" mode here.
export async function withIdempotency(
  admin: AdminClient,
  key: { botName: BotName; endpoint: string; idempotencyKey: string },
  run: () => Promise<{ status: number; body: unknown }>
): Promise<IdempotentResult> {
  const { data: existing } = await admin
    .from('bot_idempotency_keys')
    .select('response_status, response_body')
    .eq('bot_name', key.botName)
    .eq('endpoint', key.endpoint)
    .eq('idempotency_key', key.idempotencyKey)
    .maybeSingle()
  if (existing) {
    return { status: existing.response_status as number, body: existing.response_body, replayed: true }
  }

  const result = await run()

  const { error: insertError } = await admin.from('bot_idempotency_keys').insert({
    bot_name: key.botName,
    endpoint: key.endpoint,
    idempotency_key: key.idempotencyKey,
    response_status: result.status,
    response_body: result.body as never,
  })

  if (insertError) {
    // Unique-violation race: two concurrent requests with the same key both
    // passed the lookup above before either inserted. Whichever lost the
    // race defers to whatever the winner actually stored, rather than
    // returning its own (possibly duplicate-causing) result.
    const { data: winner } = await admin
      .from('bot_idempotency_keys')
      .select('response_status, response_body')
      .eq('bot_name', key.botName)
      .eq('endpoint', key.endpoint)
      .eq('idempotency_key', key.idempotencyKey)
      .maybeSingle()
    if (winner) {
      return { status: winner.response_status as number, body: winner.response_body, replayed: true }
    }
  }

  return { ...result, replayed: false }
}

export function requireIdempotencyKey(request: Request): string | null {
  const key = request.headers.get('idempotency-key')
  return key && key.trim() ? key.trim() : null
}

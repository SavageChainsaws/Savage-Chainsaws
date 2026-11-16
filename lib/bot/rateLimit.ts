import type { createAdminClient } from '@/lib/supabase/admin'
import type { BotName } from './auth'

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>

export const RATE_LIMIT_WINDOW_SECONDS = 60
export const RATE_LIMIT_MAX_PER_WINDOW = 120

// Pure threshold check, kept separate from the DB count so the actual
// limiting decision is unit-testable without a live database - withBotAuth
// supplies the real count from bot_audit_log.
export function isRateLimited(recentCount: number, limit: number = RATE_LIMIT_MAX_PER_WINDOW): boolean {
  return recentCount >= limit
}

// Counts this bot's own bot_audit_log rows in the last RATE_LIMIT_WINDOW_SECONDS
// - a simple fixed-lookback count rather than a token bucket, which is
// enough to catch a runaway/misbehaving bot without needing a separate
// counters table. Scoped by bot_name, not by individual token, so revoking
// one token and minting another doesn't reset the window - the limit is
// per bot scope, matching how every other bot-wide rule in this codebase
// (the reminder throttle, the audit log itself) is scoped.
//
// action = 'rate_limit' rows are excluded from the count - those are the
// denial withBotAuth itself logs every time THIS check trips. Without the
// exclusion, each 429 a bot gets while waiting out its own window would add
// another "recent" row this same query then counts, pushing the window
// forward again on every retry - a client that politely retries after a
// 429 would keep re-triggering one, forever, instead of the lockout
// actually expiring after RATE_LIMIT_WINDOW_SECONDS of real inactivity.
export async function checkRateLimit(admin: AdminClient, botName: BotName): Promise<boolean> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_SECONDS * 1000).toISOString()
  const { count } = await admin
    .from('bot_audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('bot_name', botName)
    .neq('action', 'rate_limit')
    .gte('created_at', since)
  return isRateLimited(count ?? 0)
}

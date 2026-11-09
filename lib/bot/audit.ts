import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>

// ANONYMOUS_BOT_LABEL is the one legitimate non-BotName value ever passed
// as botName - see lib/bot/respond.ts for why a failed/unauthenticated
// call is logged under this instead of the real bot_name it was aimed at.
export const ANONYMOUS_BOT_LABEL = 'anonymous'

// One row per bot action attempt, success or denied - `detail` must never
// contain a token, Authorization header, or other secret. Best-effort:
// a logging failure is swallowed (console.error only) rather than failing
// the actual bot request, since the audit trail is observability, not a
// correctness gate. botName is a plain string, not BotName - this file is
// the one place that's deliberate (see ANONYMOUS_BOT_LABEL above); every
// other caller of this module still only ever passes a real BotName.
export async function logBotAction(
  admin: AdminClient,
  entry: {
    botName: string
    action: string
    endpoint: string
    targetTable?: string | null
    targetId?: string | null
    outcome: 'success' | 'denied' | 'error'
    detail?: Record<string, unknown> | null
  }
): Promise<void> {
  try {
    await admin.from('bot_audit_log').insert({
      bot_name: entry.botName,
      action: entry.action,
      endpoint: entry.endpoint,
      target_table: entry.targetTable ?? null,
      target_id: entry.targetId ?? null,
      outcome: entry.outcome,
      detail: entry.detail ?? null,
    })
  } catch (err) {
    console.error('Failed to write bot_audit_log entry:', err)
  }
}

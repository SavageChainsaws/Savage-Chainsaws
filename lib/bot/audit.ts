import type { createAdminClient } from '@/lib/supabase/admin'
import type { BotName } from './auth'

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>

// One row per bot action attempt, success or denied - `detail` must never
// contain a token, Authorization header, or other secret. Best-effort:
// a logging failure is swallowed (console.error only) rather than failing
// the actual bot request, since the audit trail is observability, not a
// correctness gate.
export async function logBotAction(
  admin: AdminClient,
  entry: {
    botName: BotName
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

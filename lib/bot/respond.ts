import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyBotToken, type BotName } from './auth'
import { logBotAction } from './audit'

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>

// Every /api/bot/* route wraps its handler in this: verifies the bearer
// token names the SPECIFIC bot the route is for (an App Bot token can
// never reach a Financial Bot route or vice versa), audits a denial, and
// turns an unhandled throw into a logged 500 instead of leaking a stack
// trace. The handler receives the already-verified bot identity and an
// admin (service-role) client - RLS can't gate a bot with no auth.uid(),
// so every permission decision inside the handler is enforced in code,
// never assumed from RLS.
export async function withBotAuth(
  request: Request,
  requiredBot: BotName,
  endpoint: string,
  handler: (ctx: { admin: AdminClient; botName: BotName }) => Promise<Response>
): Promise<Response> {
  const admin = createAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'Not configured - SUPABASE_SERVICE_ROLE_KEY is missing.' }, { status: 500 })
  }

  const identity = await verifyBotToken(request, requiredBot)
  if (!identity) {
    await logBotAction(admin, {
      botName: requiredBot,
      action: 'auth',
      endpoint,
      outcome: 'denied',
      detail: { reason: 'invalid_missing_or_wrong_bot_token' },
    })
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  }

  try {
    return await handler({ admin, botName: identity.botName })
  } catch (err) {
    await logBotAction(admin, {
      botName: identity.botName,
      action: 'unhandled_error',
      endpoint,
      outcome: 'error',
      detail: { message: err instanceof Error ? err.message : String(err) },
    })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status })
}

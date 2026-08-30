type SendEmailArgs = { to: string; subject: string; html: string }
type SendEmailResult = { ok: true } | { ok: false; error: string }

// Thin wrapper around Resend's HTTP API - no SDK dependency, just a plain
// fetch. Reads RESEND_API_KEY from the environment; until that's set in
// production, every send fails fast with a clear error instead of making a
// network call, so callers can surface why nothing went out (e.g. logged to
// a unit's history) rather than silently doing nothing.
export async function sendEmail({ to, subject, html }: SendEmailArgs): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return { ok: false, error: 'email not sent - RESEND_API_KEY is not configured yet' }
  }
  // Resend's shared sandbox sender works with no domain verification, so
  // nudges can go out the moment an API key is added - swap in a verified
  // domain sender (RESEND_FROM_EMAIL) once one's set up.
  const from = process.env.RESEND_FROM_EMAIL || 'Savage Chainsaws <onboarding@resend.dev>'
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `Resend API error (${res.status}): ${body.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown email send error' }
  }
}

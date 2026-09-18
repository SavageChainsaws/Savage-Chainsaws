// Resend fetches the file itself from a public URL rather than us reading
// and base64-encoding it here - simpler and more reliable than round-
// tripping the PDF bytes through our own function first, and it still
// shows up as a real attachment (not just a link) in the customer's inbox.
type EmailAttachment = { filename: string; path: string }
type SendEmailArgs = {
  to: string | string[]
  subject: string
  html: string
  replyTo?: string
  // Overrides RESEND_FROM_EMAIL for this send - e.g. invoice emails go from
  // service@savagechainsaws.com (a real monitored mailbox) rather than
  // whatever no-reply/notifications sender other emails default to.
  from?: string
  bcc?: string | string[]
  attachments?: EmailAttachment[]
}
type SendEmailResult = { ok: true } | { ok: false; error: string }

// Thin wrapper around Resend's HTTP API - no SDK dependency, just a plain
// fetch. Reads RESEND_API_KEY from the environment; until that's set in
// production, every send fails fast with a clear error instead of making a
// network call, so callers can surface why nothing went out (e.g. logged to
// a unit's history) rather than silently doing nothing.
export async function sendEmail({ to, subject, html, replyTo, from: fromOverride, bcc, attachments }: SendEmailArgs): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return { ok: false, error: 'email not sent - RESEND_API_KEY is not configured yet' }
  }
  // Resend's shared sandbox sender works with no domain verification, so
  // nudges can go out the moment an API key is added - swap in a verified
  // domain sender (RESEND_FROM_EMAIL) once one's set up.
  const from = fromOverride || process.env.RESEND_FROM_EMAIL || 'Savage Chainsaws <onboarding@resend.dev>'
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        subject,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(bcc ? { bcc } : {}),
        ...(attachments?.length ? { attachments } : {}),
      }),
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

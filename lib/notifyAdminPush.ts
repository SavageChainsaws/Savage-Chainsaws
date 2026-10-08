// Fires the admin-facing push for an event the customer portal just wrote to
// Supabase directly (client-side, under RLS) - the actual send needs the
// VAPID private key, which only the server route holds. Best-effort: the
// unit change itself already succeeded by the time this is called, so a
// failed/slow push here should never block or error out the customer's
// own flow.
export function notifyAdminPush(event: 'service_request' | 'decision' | 'message', unitId: string, decision?: 'approve' | 'deny') {
  fetch('/api/push/notify-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, unitId, decision }),
  }).catch(() => {})
}

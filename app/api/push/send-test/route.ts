import { NextResponse } from 'next/server'
import { sendPushToAdmins } from '@/lib/push'

// Temporary route for manually confirming end-to-end delivery during the
// VAPID/grants debugging session - sends one real push, through the same
// sendPushToAdmins() used by the actual customer-triggered events (new
// service request, approve/deny), to every admin's subscribed device(s).
// Remove once delivery is confirmed.
export async function GET() {
  await sendPushToAdmins({
    title: 'Test push notification',
    body: 'If you see this, push notifications are working end-to-end.',
    url: '/',
    tag: 'test-push',
  })
  return NextResponse.json({ ok: true })
}

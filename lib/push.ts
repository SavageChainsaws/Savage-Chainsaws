import webpush from 'web-push'
import { createAdminClient } from './supabase/admin'

// Self-hosted Web Push (VAPID) - no third-party push service. Mirrors
// lib/email.ts's pattern: until the keys are configured in the environment,
// every send is a silent no-op rather than a crash, so the app works fine
// before that setup step happens.
let vapidConfigured = false
function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) return false
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:service@savagechainsaws.com',
    publicKey,
    privateKey
  )
  vapidConfigured = true
  return true
}

type PushPayload = { title: string; body: string; url?: string; tag?: string }
type SubscriptionRow = { id: string; endpoint: string; p256dh: string; auth: string }

async function sendToRow(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  row: SubscriptionRow,
  payload: PushPayload
) {
  try {
    await webpush.sendNotification(
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      JSON.stringify(payload)
    )
  } catch (err) {
    // 404/410 means the browser/OS has permanently invalidated this
    // subscription (uninstalled, permission revoked, endpoint rotated) -
    // clean it up so it's not retried forever. Any other error (offline
    // push service, rate limit, etc.) is left in place and just logged.
    const statusCode = (err as { statusCode?: number })?.statusCode
    if (statusCode === 404 || statusCode === 410) {
      await admin.from('push_subscriptions').delete().eq('id', row.id)
    } else {
      console.error('push send failed', statusCode, err instanceof Error ? err.message : err)
    }
  }
}

// Sends to every subscription (every browser/device that opted in) owned by
// each of the given auth user ids. Never throws - a missing push
// subscription, unconfigured VAPID keys, or a send failure should never
// block the caller's own action (status update, message reply, etc.).
export async function sendPushToUserIds(userIds: string[], payload: PushPayload): Promise<void> {
  const ids = [...new Set(userIds)].filter(Boolean)
  if (ids.length === 0 || !ensureVapidConfigured()) return
  const admin = createAdminClient()
  if (!admin) return
  const { data: rows } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').in('user_id', ids)
  if (!rows?.length) return
  await Promise.all(rows.map(row => sendToRow(admin, row, payload)))
}

export async function sendPushToAdmins(payload: PushPayload): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  const { data: admins } = await admin.from('profiles').select('id').eq('role', 'admin')
  await sendPushToUserIds((admins || []).map(a => a.id), payload)
}

export async function sendPushToCustomer(customerId: string, payload: PushPayload): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  const { data: customer } = await admin.from('customers').select('auth_user_id').eq('id', customerId).maybeSingle()
  if (!customer?.auth_user_id) return
  await sendPushToUserIds([customer.auth_user_id], payload)
}

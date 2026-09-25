import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

// Square signs each webhook with HMAC-SHA256 over (notification URL + raw
// body), base64-encoded, in the x-square-hmacsha256-signature header - see
// https://developer.squareup.com/docs/webhooks/step3validate. Verifying
// this (rather than trusting any POST to this URL) is what stops someone
// else from forging a fake "payment completed" event.
function isValidSquareSignature(rawBody: string, signatureHeader: string | null, notificationUrl: string): boolean {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY
  if (!signatureKey || !signatureHeader) return false
  const hmac = crypto.createHmac('sha256', signatureKey)
  hmac.update(notificationUrl + rawBody)
  const expected = hmac.digest('base64')
  // Constant-time comparison - both must be the same length for timingSafeEqual.
  const a = Buffer.from(expected)
  const b = Buffer.from(signatureHeader)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// Marks an invoice paid the moment Square reports its order as completed -
// this is the "via webhook if reasonably simple" path from the payment
// feature spec, with the admin's manual "Check Payment Status" button (see
// app/invoices/page.tsx) as the fallback for whenever this isn't
// configured (SQUARE_WEBHOOK_SIGNATURE_KEY not yet set) or a webhook
// delivery is missed.
export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signatureHeader = request.headers.get('x-square-hmacsha256-signature')
  const notificationUrl = new URL('/api/webhooks/square', request.url).toString()

  if (!isValidSquareSignature(rawBody, signatureHeader, notificationUrl)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: { type?: string; data?: { object?: { payment?: { status?: string; order_id?: string } } } }
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (event.type === 'payment.updated') {
    const payment = event.data?.object?.payment
    if (payment?.status === 'COMPLETED' && payment.order_id) {
      const admin = createAdminClient()
      if (admin) {
        await admin
          .from('invoices')
          .update({ paid_at: new Date().toISOString(), paid_via: 'square' })
          .eq('square_order_id', payment.order_id)
          .is('paid_at', null)
        // Rentals reuse the same square_order_id/paid_at shape as invoices
        // (see app/rentals/page.tsx) for whichever charge cycle is
        // currently outstanding - pickup charge or post-return balance.
        await admin
          .from('rentals')
          .update({ paid_at: new Date().toISOString(), paid_via: 'square' })
          .eq('square_order_id', payment.order_id)
          .is('paid_at', null)
      }
    }
  }

  return NextResponse.json({ received: true })
}

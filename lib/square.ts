// Thin wrapper around Square's REST API - no SDK dependency, matching
// lib/email.ts's pattern. Uses the Payment Links (Checkout) API only:
// Square's own hosted checkout page collects the card, so no payment card
// data ever touches this app - avoids PCI compliance burden entirely. Do
// not replace this with the Web Payments SDK / a custom card form.
const SQUARE_API_VERSION = '2024-01-18'

function apiBase(): string {
  // The connected merchant is a real, live Square account (not a Sandbox
  // seller) - defaults to production. SQUARE_ENVIRONMENT=sandbox is here
  // for if a genuine Sandbox account is ever connected instead.
  return process.env.SQUARE_ENVIRONMENT === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com'
}

function accessToken(): string | null {
  return process.env.SQUARE_ACCESS_TOKEN || null
}

export function squareLocationId(): string | null {
  return process.env.SQUARE_LOCATION_ID || null
}

async function squareFetch(path: string, init: RequestInit) {
  const token = accessToken()
  if (!token) {
    return { ok: false as const, error: 'Square is not configured yet - SQUARE_ACCESS_TOKEN is missing.' }
  }
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Square-Version': SQUARE_API_VERSION,
        ...init.headers,
      },
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      const message = body?.errors?.[0]?.detail || `Square API error (${res.status})`
      // Logged server-side (not returned to the client) so the full Square
      // error - category/code/detail, not just the truncated UI message -
      // shows up in Vercel runtime logs when a request is rejected.
      console.error('Square API error', {
        path,
        status: res.status,
        errors: body?.errors,
      })
      return { ok: false as const, error: message }
    }
    return { ok: true as const, data: body }
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : 'Unknown Square API error' }
  }
}

type CreatePaymentLinkArgs = {
  invoiceNumber: string
  amountCents: number
  buyerEmail?: string | null
  redirectUrl: string
}
type CreatePaymentLinkResult =
  | { ok: true; url: string; paymentLinkId: string; orderId: string | null }
  | { ok: false; error: string }

export async function createSquarePaymentLink({
  invoiceNumber,
  amountCents,
  buyerEmail,
  redirectUrl,
}: CreatePaymentLinkArgs): Promise<CreatePaymentLinkResult> {
  const locationId = squareLocationId()
  if (!locationId) {
    return { ok: false, error: 'Square is not configured yet - SQUARE_LOCATION_ID is missing.' }
  }
  const result = await squareFetch('/v2/online-checkout/payment-links', {
    method: 'POST',
    body: JSON.stringify({
      idempotency_key: `invoice-${invoiceNumber}-${Date.now()}`,
      quick_pay: {
        name: `Invoice ${invoiceNumber} - Savage Chainsaws`,
        price_money: { amount: amountCents, currency: 'USD' },
        location_id: locationId,
      },
      checkout_options: {
        redirect_url: redirectUrl,
        merchant_support_email: 'service@savagechainsaws.com',
      },
      ...(buyerEmail ? { pre_populated_data: { buyer_email: buyerEmail } } : {}),
    }),
  })
  if (!result.ok) return result
  const link = result.data?.payment_link
  if (!link?.url || !link?.id) {
    return { ok: false, error: 'Square did not return a payment link URL.' }
  }
  return { ok: true, url: link.url, paymentLinkId: link.id, orderId: link.order_id ?? null }
}

type OrderStatusResult =
  | { ok: true; paid: boolean }
  | { ok: false; error: string }

// The Orders API is the source of truth for whether a Payment Links order
// has actually been paid - COMPLETED means a payment was captured against
// it, never assumed just because a link was generated or opened.
export async function getSquareOrderPaidStatus(orderId: string): Promise<OrderStatusResult> {
  const result = await squareFetch(`/v2/orders/${orderId}`, { method: 'GET' })
  if (!result.ok) return result
  const state = result.data?.order?.state
  // Logged unconditionally (this is a 200 response either way, so
  // squareFetch's own error logging never fires here) - the "Check Payment
  // Status" button was reporting "Not paid yet" for an order Square's own
  // dashboard showed as sold, so the actual state Square returns needs to
  // be visible rather than collapsed into a single paid/not-paid boolean.
  console.log('Square order status check', { orderId, state, tenders: result.data?.order?.tenders?.length ?? 0 })
  return { ok: true, paid: state === 'COMPLETED' }
}

export function isSquareConfigured(): boolean {
  return !!accessToken() && !!squareLocationId()
}

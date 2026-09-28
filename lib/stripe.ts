import Stripe from 'stripe'

// Stripe replaces Square as the card processor (see lib/square.ts, kept
// around only so already-outstanding Square links sent before this cutover
// still get marked paid). Uses Stripe Checkout Sessions - Stripe's hosted
// payment page - so no card data ever touches this app, same PCI-avoidance
// reasoning Square's Payment Links had. Do not replace this with Stripe
// Elements / a custom card form embedded on our own pages.
let stripeClient: Stripe | null | undefined

function client(): Stripe | null {
  if (stripeClient !== undefined) return stripeClient
  const key = process.env.STRIPE_SECRET_KEY
  stripeClient = key ? new Stripe(key) : null
  return stripeClient
}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}

type CreateCheckoutSessionArgs = {
  invoiceNumber: string
  amountCents: number
  buyerEmail?: string | null
  redirectUrl: string
}
type CreateCheckoutSessionResult =
  | { ok: true; url: string; sessionId: string }
  | { ok: false; error: string }

export async function createStripeCheckoutSession({
  invoiceNumber,
  amountCents,
  buyerEmail,
  redirectUrl,
}: CreateCheckoutSessionArgs): Promise<CreateCheckoutSessionResult> {
  const stripe = client()
  if (!stripe) {
    return { ok: false, error: 'Stripe is not configured yet - STRIPE_SECRET_KEY is missing.' }
  }
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: amountCents,
            product_data: { name: `Invoice ${invoiceNumber} - Savage Chainsaws` },
          },
          quantity: 1,
        },
      ],
      success_url: redirectUrl,
      cancel_url: redirectUrl,
      ...(buyerEmail ? { customer_email: buyerEmail } : {}),
    })
    if (!session.url || !session.id) {
      return { ok: false, error: 'Stripe did not return a checkout session URL.' }
    }
    return { ok: true, url: session.url, sessionId: session.id }
  } catch (err) {
    // Logged server-side so the full Stripe error shows up in Vercel
    // runtime logs when a request is rejected, mirroring lib/square.ts.
    console.error('Stripe API error', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown Stripe API error' }
  }
}

type SessionStatusResult =
  | { ok: true; paid: boolean }
  | { ok: false; error: string }

// payment_status is Stripe's own source of truth for whether a Checkout
// Session was actually paid - 'paid' once a successful payment is attached,
// distinct from the session's lifecycle status (open/complete/expired),
// same "don't infer from state alone" reasoning as Square's tenders check.
export async function getStripeSessionPaidStatus(sessionId: string): Promise<SessionStatusResult> {
  const stripe = client()
  if (!stripe) {
    return { ok: false, error: 'Stripe is not configured yet - STRIPE_SECRET_KEY is missing.' }
  }
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    const paid = session.payment_status === 'paid'
    console.log('Stripe session status check', { sessionId, payment_status: session.payment_status, paid })
    return { ok: true, paid }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown Stripe API error' }
  }
}

export function stripeWebhookClient(): Stripe | null {
  return client()
}

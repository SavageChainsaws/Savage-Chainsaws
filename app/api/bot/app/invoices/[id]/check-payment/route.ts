import { NextRequest, NextResponse } from 'next/server'
import { withBotAuth, jsonError } from '@/lib/bot/respond'
import { logBotAction } from '@/lib/bot/audit'
import { getStripeSessionStatus } from '@/lib/stripe'
import { getSquareOrderPaidStatus } from '@/lib/square'

// Recheck-only - never trusts the bot's own assertion. paid_at/paid_via are
// written ONLY when the actual payment provider (Stripe or Square, whichever
// this invoice's link was created through) confirms the charge went
// through. No idempotency key is required: this is a pure read-and-maybe-
// sync operation, safe to call any number of times - it can never create a
// duplicate record, and running it twice in a row either confirms the same
// already-paid state or finds nothing new.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const endpoint = `POST /api/bot/app/invoices/${id}/check-payment`
  return withBotAuth(request, 'app_bot', endpoint, async ({ admin, botName }) => {
    const { data: invoice } = await admin
      .from('invoices')
      .select('id, amount, stripe_checkout_session_id, square_order_id, paid_at, paid_via')
      .eq('id', id)
      .maybeSingle()
    if (!invoice) return jsonError(404, 'Invoice not found.')

    if (invoice.paid_at) {
      return NextResponse.json({ paid: true, paid_via: invoice.paid_via, already_known: true })
    }
    if (!invoice.stripe_checkout_session_id && !invoice.square_order_id) {
      return NextResponse.json({ paid: false, reason: 'no_payment_link_generated' })
    }

    const result = invoice.stripe_checkout_session_id
      ? await getStripeSessionStatus(invoice.stripe_checkout_session_id)
      : await getSquareOrderPaidStatus(invoice.square_order_id as string)
    if (!result.ok) {
      await logBotAction(admin, { botName, action: 'invoice_check_payment', endpoint, targetTable: 'invoices', targetId: id, outcome: 'error', detail: { message: result.error } })
      return jsonError(502, result.error)
    }

    if (result.paid) {
      const paidVia = invoice.stripe_checkout_session_id ? 'stripe' : 'square'
      const { error } = await admin.from('invoices').update({ paid_at: new Date().toISOString(), paid_via: paidVia }).eq('id', id)
      if (error) return jsonError(500, error.message)
      await logBotAction(admin, { botName, action: 'invoice_check_payment', endpoint, targetTable: 'invoices', targetId: id, outcome: 'success', detail: { paid: true, paid_via: paidVia } })
      return NextResponse.json({ paid: true, paid_via: paidVia })
    }

    await logBotAction(admin, { botName, action: 'invoice_check_payment', endpoint, targetTable: 'invoices', targetId: id, outcome: 'success', detail: { paid: false } })
    return NextResponse.json({ paid: false })
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { withBotAuth, jsonError } from '@/lib/bot/respond'
import { withIdempotency, requireIdempotencyKey } from '@/lib/bot/idempotency'
import { logBotAction } from '@/lib/bot/audit'
import { canSendReminder, REMINDER_MIN_INTERVAL_DAYS } from '@/lib/bot/rules'
import { getStripeSessionStatus, createStripeCheckoutSession } from '@/lib/stripe'
import { getSquareOrderPaidStatus } from '@/lib/square'
import { sendEmail } from '@/lib/email'
import { escapeHtml } from '@/lib/text'

// Only ever reminds about an invoice already emailed to the customer once
// before (sent_at set - see lib/bot/rules.ts for why that, not `status`,
// is the real "sent" signal) - this endpoint never creates or sends a
// brand-new invoice. Fails closed throughout: a payment-provider error, an
// amount mismatch, or a failed email send all abort with nothing sent and
// nothing marked paid, rather than guessing. The 3-day throttle itself is
// enforced atomically in Postgres (claim_invoice_reminder, with an
// advisory lock keyed on the invoice id) so two concurrent calls for the
// same invoice can never both get through - canSendReminder below is only
// a fast local pre-check for the OTHER reasons a reminder can be blocked.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const endpoint = `POST /api/bot/app/invoices/${id}/send-reminder`
  return withBotAuth(request, 'app_bot', endpoint, async ({ admin, botName }) => {
    const idempotencyKey = requireIdempotencyKey(request)
    if (!idempotencyKey) return jsonError(400, 'Missing required Idempotency-Key header.')

    const result = await withIdempotency(admin, { botName, endpoint, idempotencyKey }, async () => {
      const { data: invoice } = await admin
        .from('invoices')
        .select(
          'id, invoice_number, amount, status, sent_at, due_date, paid_at, paid_via, archived_at, zelle_claim_reference, customer_email, customer_id, stripe_checkout_session_id, stripe_payment_link_url, square_order_id, square_payment_link_url'
        )
        .eq('id', id)
        .maybeSingle()
      if (!invoice) return { status: 404, body: { error: 'Invoice not found.' } }

      const { data: plan } = await admin.from('invoice_payment_plans').select('status').eq('invoice_id', id).maybeSingle()
      const hasActivePaymentPlan = !!plan && plan.status !== 'Completed'

      // Fresh recheck, failing closed - if the provider can't be reached,
      // we do not know the real state, so nothing gets sent. (The previous
      // version silently fell through to "send anyway" on a check error,
      // which could nag an already-paid customer.)
      let paidAt = invoice.paid_at
      let paidVia = invoice.paid_via
      let stripeOpen: boolean | null = null
      if (!paidAt && invoice.stripe_checkout_session_id) {
        const check = await getStripeSessionStatus(invoice.stripe_checkout_session_id)
        if (!check.ok) {
          await logBotAction(admin, { botName, action: 'invoice_send_reminder', endpoint, targetTable: 'invoices', targetId: id, outcome: 'error', detail: { reason: 'payment_check_failed', message: check.error } })
          return { status: 502, body: { error: `Could not verify payment status - nothing sent. ${check.error}` } }
        }
        stripeOpen = check.open
        if (check.paid) {
          // Require a CONFIRMED matching amount, not just "not mismatched" -
          // an unknown amount (null) must fail closed exactly like a
          // mismatched one, never be treated as "no problem found".
          const invoiceAmountCents = Math.round(Number(invoice.amount) * 100)
          if (check.amountTotalCents == null || check.amountTotalCents !== invoiceAmountCents) {
            await logBotAction(admin, { botName, action: 'invoice_send_reminder', endpoint, targetTable: 'invoices', targetId: id, outcome: 'denied', detail: { reason: check.amountTotalCents == null ? 'amount_unconfirmed' : 'amount_mismatch', invoiceAmountCents, paidAmountCents: check.amountTotalCents } })
            return { status: 409, body: { error: 'Payment provider shows paid, but the amount could not be confirmed against this invoice - nothing sent. Needs manual review.' } }
          }
          paidVia = 'stripe'
          paidAt = new Date().toISOString()
          await admin.from('invoices').update({ paid_at: paidAt, paid_via: paidVia }).eq('id', id)
        }
      } else if (!paidAt && invoice.square_order_id) {
        const check = await getSquareOrderPaidStatus(invoice.square_order_id)
        if (!check.ok) {
          await logBotAction(admin, { botName, action: 'invoice_send_reminder', endpoint, targetTable: 'invoices', targetId: id, outcome: 'error', detail: { reason: 'payment_check_failed', message: check.error } })
          return { status: 502, body: { error: `Could not verify payment status - nothing sent. ${check.error}` } }
        }
        if (check.paid) {
          // Same fail-closed-on-unknown-amount rule as above - Square can
          // report paid=true with no tenders (order.state === 'COMPLETED'
          // but tenderCount === 0), which leaves paidAmountCents null.
          const invoiceAmountCents = Math.round(Number(invoice.amount) * 100)
          if (check.paidAmountCents == null || check.paidAmountCents !== invoiceAmountCents) {
            await logBotAction(admin, { botName, action: 'invoice_send_reminder', endpoint, targetTable: 'invoices', targetId: id, outcome: 'denied', detail: { reason: check.paidAmountCents == null ? 'amount_unconfirmed' : 'amount_mismatch', invoiceAmountCents, paidAmountCents: check.paidAmountCents } })
            return { status: 409, body: { error: 'Payment provider shows paid, but the amount could not be confirmed against this invoice - nothing sent. Needs manual review.' } }
          }
          paidVia = 'square'
          paidAt = new Date().toISOString()
          await admin.from('invoices').update({ paid_at: paidAt, paid_via: paidVia }).eq('id', id)
        }
      }

      const decision = canSendReminder({
        sentAt: invoice.sent_at,
        paidAt,
        dueDate: invoice.due_date,
        archivedAt: invoice.archived_at,
        zelleClaimPending: !!invoice.zelle_claim_reference && !paidAt,
        hasActivePaymentPlan,
        lastReminderSentAt: null,
      })
      if (!decision.allowed) {
        await logBotAction(admin, { botName, action: 'invoice_send_reminder', endpoint, targetTable: 'invoices', targetId: id, outcome: 'denied', detail: { reason: decision.reason } })
        return { status: 409, body: { error: `Reminder not sent: ${decision.reason}` } }
      }

      // Refresh an expired Stripe link rather than emailing a dead one -
      // Checkout Sessions in payment mode always expire (Stripe caps it at
      // 24h). A Square link has no such expiry. If refreshing fails, this
      // refuses to send rather than mailing a link that can't be paid.
      let paymentLink = invoice.stripe_payment_link_url || invoice.square_payment_link_url
      if (invoice.stripe_checkout_session_id && stripeOpen === false) {
        const amountCents = Math.round(Number(invoice.amount) * 100)
        let buyerEmail = invoice.customer_email
        if (!buyerEmail && invoice.customer_id) {
          const { data: customer } = await admin.from('customers').select('email').eq('id', invoice.customer_id).maybeSingle()
          buyerEmail = customer?.email ?? null
        }
        const fresh = amountCents > 0
          ? await createStripeCheckoutSession({ invoiceNumber: invoice.invoice_number, amountCents, buyerEmail, redirectUrl: 'https://app.savagechainsaws.com/invoices' })
          : { ok: false as const, error: 'No positive total to charge.' }
        if (!fresh.ok) {
          await logBotAction(admin, { botName, action: 'invoice_send_reminder', endpoint, targetTable: 'invoices', targetId: id, outcome: 'error', detail: { reason: 'stripe_link_refresh_failed', message: fresh.error } })
          return { status: 502, body: { error: `The payment link had expired and a new one could not be generated - nothing sent. ${fresh.error}` } }
        }
        await admin.from('invoices').update({ stripe_checkout_session_id: fresh.sessionId, stripe_payment_link_url: fresh.url }).eq('id', id)
        paymentLink = fresh.url
      }
      if (!paymentLink) {
        await logBotAction(admin, { botName, action: 'invoice_send_reminder', endpoint, targetTable: 'invoices', targetId: id, outcome: 'denied', detail: { reason: 'no_payment_link_on_file' } })
        return { status: 409, body: { error: 'Reminder not sent: no payment link on file for this invoice yet.' } }
      }

      let recipient = invoice.customer_email
      if (!recipient && invoice.customer_id) {
        const { data: customer } = await admin.from('customers').select('email').eq('id', invoice.customer_id).maybeSingle()
        recipient = customer?.email ?? null
      }
      if (!recipient) {
        await logBotAction(admin, { botName, action: 'invoice_send_reminder', endpoint, targetTable: 'invoices', targetId: id, outcome: 'denied', detail: { reason: 'no_email_on_file' } })
        return { status: 409, body: { error: 'Reminder not sent: no email address on file for this customer.' } }
      }

      // Atomic claim - the actual, race-safe throttle enforcement. Must
      // happen AFTER every other check above (no point claiming a slot for
      // a reminder that was never going to send) and BEFORE the email call
      // (so two concurrent callers can never both send).
      const { data: claimRows, error: claimError } = await admin.rpc('claim_invoice_reminder', {
        p_invoice_id: id,
        p_bot_name: botName,
        p_min_interval_hours: REMINDER_MIN_INTERVAL_DAYS * 24,
      })
      if (claimError) {
        await logBotAction(admin, { botName, action: 'invoice_send_reminder', endpoint, targetTable: 'invoices', targetId: id, outcome: 'error', detail: { message: claimError.message } })
        return { status: 500, body: { error: claimError.message } }
      }
      const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows
      if (!claim?.claimed) {
        await logBotAction(admin, { botName, action: 'invoice_send_reminder', endpoint, targetTable: 'invoices', targetId: id, outcome: 'denied', detail: { reason: 'throttled' } })
        return { status: 409, body: { error: 'Reminder not sent: throttled' } }
      }

      const dueDateLabel = new Date(`${invoice.due_date}T00:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      // Every interpolated value is HTML-escaped before going into the
      // email body - invoice_number/paymentLink are server-generated, not
      // customer input, but escaping costs nothing and means this template
      // stays safe if a less-trusted field is ever added to it later.
      const emailResult = await sendEmail({
        to: recipient,
        subject: `Reminder: Invoice ${invoice.invoice_number} - Savage Chainsaws`,
        html: `<p>This is a friendly reminder that invoice <strong>${escapeHtml(invoice.invoice_number)}</strong> for $${Number(invoice.amount).toFixed(2)}, due ${escapeHtml(dueDateLabel)}, is still unpaid.</p><p><a href="${escapeHtml(paymentLink)}">Pay now</a></p><p>Thanks,<br>Savage Chainsaws</p>`,
        from: 'Savage Chainsaws <service@savagechainsaws.com>',
      })
      if (!emailResult.ok) {
        await admin.rpc('release_invoice_reminder_claim', { p_reminder_id: claim.reminder_id })
        await logBotAction(admin, { botName, action: 'invoice_send_reminder', endpoint, targetTable: 'invoices', targetId: id, outcome: 'error', detail: { message: emailResult.error } })
        return { status: 502, body: { error: emailResult.error } }
      }

      await admin.rpc('finalize_invoice_reminder_claim', { p_reminder_id: claim.reminder_id, p_sent_to: recipient })
      await logBotAction(admin, { botName, action: 'invoice_send_reminder', endpoint, targetTable: 'invoices', targetId: id, outcome: 'success' })
      return { status: 200, body: { sent: true, sent_to: recipient } }
    })

    return NextResponse.json(result.body, { status: result.status, headers: result.replayed ? { 'Idempotent-Replay': 'true' } : undefined })
  })
}

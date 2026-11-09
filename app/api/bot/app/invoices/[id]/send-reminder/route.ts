import { NextRequest, NextResponse } from 'next/server'
import { withBotAuth, jsonError } from '@/lib/bot/respond'
import { withIdempotency, requireIdempotencyKey } from '@/lib/bot/idempotency'
import { logBotAction } from '@/lib/bot/audit'
import { canSendReminder } from '@/lib/bot/rules'
import { getStripeSessionStatus } from '@/lib/stripe'
import { getSquareOrderPaidStatus } from '@/lib/square'
import { sendEmail } from '@/lib/email'

// Only ever reminds about an invoice already sent once before - this
// endpoint never creates or sends a brand-new invoice (that first send is
// Jesse's call). Re-verifies payment status fresh (never trusts a stale
// paid_at) before checking the throttle, reuses the invoice's existing
// stored payment link (never generates a new one here), and only actually
// emails once canSendReminder allows it. Every attempt - sent, blocked by
// the rule, or found to already be paid - is logged; a reminder actually
// sent also gets its own row in invoice_reminders so the next call's
// throttle check sees it.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const endpoint = `POST /api/bot/app/invoices/${id}/send-reminder`
  return withBotAuth(request, 'app_bot', endpoint, async ({ admin, botName }) => {
    const idempotencyKey = requireIdempotencyKey(request)
    if (!idempotencyKey) return jsonError(400, 'Missing required Idempotency-Key header.')

    const result = await withIdempotency(admin, { botName, endpoint, idempotencyKey }, async () => {
      const { data: invoice } = await admin
        .from('invoices')
        .select('id, invoice_number, amount, status, due_date, paid_at, paid_via, customer_email, customer_id, stripe_checkout_session_id, stripe_payment_link_url, square_order_id, square_payment_link_url')
        .eq('id', id)
        .maybeSingle()
      if (!invoice) return { status: 404, body: { error: 'Invoice not found.' } }

      // Fresh recheck - canSendReminder must see the real, current paid
      // state, never a stale cached paid_at.
      let paidAt = invoice.paid_at
      let paidVia = invoice.paid_via
      if (!paidAt && (invoice.stripe_checkout_session_id || invoice.square_order_id)) {
        const check = invoice.stripe_checkout_session_id
          ? await getStripeSessionStatus(invoice.stripe_checkout_session_id)
          : await getSquareOrderPaidStatus(invoice.square_order_id as string)
        if (check.ok && check.paid) {
          paidVia = invoice.stripe_checkout_session_id ? 'stripe' : 'square'
          paidAt = new Date().toISOString()
          await admin.from('invoices').update({ paid_at: paidAt, paid_via: paidVia }).eq('id', id)
        }
      }

      const { data: lastReminder } = await admin
        .from('invoice_reminders')
        .select('sent_at')
        .eq('invoice_id', id)
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const decision = canSendReminder({
        invoiceStatus: invoice.status,
        paidAt,
        dueDate: invoice.due_date,
        lastReminderSentAt: lastReminder?.sent_at ?? null,
      })
      if (!decision.allowed) {
        await logBotAction(admin, { botName, action: 'invoice_send_reminder', endpoint, targetTable: 'invoices', targetId: id, outcome: 'denied', detail: { reason: decision.reason } })
        return { status: 409, body: { error: `Reminder not sent: ${decision.reason}` } }
      }

      const paymentLink = invoice.stripe_payment_link_url || invoice.square_payment_link_url
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

      const dueDateLabel = new Date(`${invoice.due_date}T00:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      const emailResult = await sendEmail({
        to: recipient,
        subject: `Reminder: Invoice ${invoice.invoice_number} - Savage Chainsaws`,
        html: `<p>This is a friendly reminder that invoice <strong>${invoice.invoice_number}</strong> for $${Number(invoice.amount).toFixed(2)}, due ${dueDateLabel}, is still unpaid.</p><p><a href="${paymentLink}">Pay now</a></p><p>Thanks,<br>Savage Chainsaws</p>`,
        from: 'Savage Chainsaws <service@savagechainsaws.com>',
      })
      if (!emailResult.ok) {
        await logBotAction(admin, { botName, action: 'invoice_send_reminder', endpoint, targetTable: 'invoices', targetId: id, outcome: 'error', detail: { message: emailResult.error } })
        return { status: 502, body: { error: emailResult.error } }
      }

      await admin.from('invoice_reminders').insert({ invoice_id: id, sent_to: recipient, bot_name: botName })
      await logBotAction(admin, { botName, action: 'invoice_send_reminder', endpoint, targetTable: 'invoices', targetId: id, outcome: 'success' })
      return { status: 200, body: { sent: true, sent_to: recipient } }
    })

    return NextResponse.json(result.body, { status: result.status, headers: result.replayed ? { 'Idempotent-Replay': 'true' } : undefined })
  })
}

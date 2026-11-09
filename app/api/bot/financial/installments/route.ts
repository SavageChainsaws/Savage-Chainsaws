import { NextRequest, NextResponse } from 'next/server'
import { withBotAuth, jsonError } from '@/lib/bot/respond'
import { logBotAction } from '@/lib/bot/audit'

// Read-only. Reads the real installment records (invoice_installments,
// joined through invoice_payment_plans to the parent invoice) rather than
// just flagging invoices where payment_plan_offered is true - that flag
// only means a plan was offered, not that the customer ever chose one or
// what its actual schedule/amounts are. Same narrow shape as every other
// /api/bot/financial/* route: customer id+name only, no contact details.
export async function GET(request: NextRequest) {
  return withBotAuth(request, 'financial_bot', 'GET /api/bot/financial/installments', async ({ admin, botName }) => {
    const { data, error } = await admin
      .from('invoice_installments')
      .select(
        'id, sequence, amount, due_date, paid_at, paid_via, plan_id, invoice_id, invoice_payment_plans(status, installment_count, frequency), invoices(invoice_number, customer_id, customer_name)'
      )
      .order('due_date', { ascending: true })
      .limit(500)
    if (error) return jsonError(500, error.message)

    const installments = (data || []).map(row => {
      const plan = row.invoice_payment_plans as unknown as { status: string; installment_count: number; frequency: string } | null
      const invoice = row.invoices as unknown as { invoice_number: string | null; customer_id: string | null; customer_name: string | null } | null
      return {
        id: row.id,
        invoice_id: row.invoice_id,
        invoice_number: invoice?.invoice_number ?? null,
        customer_id: invoice?.customer_id ?? null,
        customer_name: invoice?.customer_name ?? null,
        sequence: row.sequence,
        amount: row.amount,
        due_date: row.due_date,
        paid_at: row.paid_at,
        paid_via: row.paid_via,
        plan_status: plan?.status ?? null,
        plan_installment_count: plan?.installment_count ?? null,
        plan_frequency: plan?.frequency ?? null,
      }
    })

    await logBotAction(admin, { botName, action: 'installments_read', endpoint: 'GET /api/bot/financial/installments', outcome: 'success', detail: { count: installments.length } })
    return NextResponse.json({ installments })
  })
}

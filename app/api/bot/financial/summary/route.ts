import { NextRequest, NextResponse } from 'next/server'
import { withBotAuth, jsonError } from '@/lib/bot/respond'
import { logBotAction } from '@/lib/bot/audit'

const ROW_LIMIT = 1000

type InvoiceRow = {
  id: string
  customer_id: string | null
  customer_name: string | null
  amount: number | null
  status: string
  due_date: string | null
  paid_at: string | null
  created_at: string
}

// Read-only aggregate - outstanding balances bucketed by age, plus revenue
// (paid total) for the requested window. No contact details or service
// notes anywhere in this response, same scope limit as every other
// /api/bot/financial/* route.
export async function GET(request: NextRequest) {
  return withBotAuth(request, 'financial_bot', 'GET /api/bot/financial/summary', async ({ admin, botName }) => {
    const { searchParams } = request.nextUrl
    const sinceParam = searchParams.get('revenue_since')
    const revenueSince = sinceParam || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    // archived_at is excluded from "outstanding" - an archived-but-unpaid
    // invoice is a write-off Jesse has already decided not to collect on,
    // not real outstanding receivable.
    const [{ data: openInvoices, error: openError }, { data: paidInvoices, error: paidError }] = await Promise.all([
      admin
        .from('invoices')
        .select('id, customer_id, customer_name, amount, status, due_date, paid_at, created_at')
        .is('paid_at', null)
        .is('archived_at', null)
        .neq('status', 'draft')
        .limit(ROW_LIMIT),
      admin
        .from('invoices')
        .select('id, customer_id, customer_name, amount, status, due_date, paid_at, created_at')
        .not('paid_at', 'is', null)
        .gte('paid_at', revenueSince)
        .limit(ROW_LIMIT),
    ])
    if (openError) return jsonError(500, openError.message)
    if (paidError) return jsonError(500, paidError.message)
    // A result that hit the row limit is an incomplete aggregate, not the
    // true total - callers must know that rather than silently trusting a
    // truncated sum.
    const truncated = (openInvoices?.length ?? 0) >= ROW_LIMIT || (paidInvoices?.length ?? 0) >= ROW_LIMIT

    const now = Date.now()
    const aging = { current: [] as InvoiceRow[], days_1_30: [] as InvoiceRow[], days_31_60: [] as InvoiceRow[], days_61_90: [] as InvoiceRow[], days_90_plus: [] as InvoiceRow[], missing_due_date: [] as InvoiceRow[] }
    let outstandingTotal = 0

    for (const invoice of (openInvoices || []) as InvoiceRow[]) {
      outstandingTotal += Number(invoice.amount) || 0
      if (!invoice.due_date) {
        aging.missing_due_date.push(invoice)
        continue
      }
      const daysPastDue = Math.floor((now - new Date(`${invoice.due_date}T00:00:00`).getTime()) / (24 * 60 * 60 * 1000))
      if (daysPastDue <= 0) aging.current.push(invoice)
      else if (daysPastDue <= 30) aging.days_1_30.push(invoice)
      else if (daysPastDue <= 60) aging.days_31_60.push(invoice)
      else if (daysPastDue <= 90) aging.days_61_90.push(invoice)
      else aging.days_90_plus.push(invoice)
    }

    const revenueTotal = (paidInvoices || []).reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0)

    const summarize = (rows: InvoiceRow[]) => ({
      count: rows.length,
      total: Math.round(rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0) * 100) / 100,
      invoices: rows.map(r => ({ id: r.id, customer_id: r.customer_id, customer_name: r.customer_name, amount: r.amount, due_date: r.due_date })),
    })

    await logBotAction(admin, { botName, action: 'summary_read', endpoint: 'GET /api/bot/financial/summary', outcome: 'success', detail: { truncated } })
    return NextResponse.json({
      outstanding_total: Math.round(outstandingTotal * 100) / 100,
      truncated,
      aging: {
        current: summarize(aging.current),
        days_1_30: summarize(aging.days_1_30),
        days_31_60: summarize(aging.days_31_60),
        days_61_90: summarize(aging.days_61_90),
        days_90_plus: summarize(aging.days_90_plus),
        missing_due_date: summarize(aging.missing_due_date),
      },
      revenue: { since: revenueSince, total: Math.round(revenueTotal * 100) / 100, count: (paidInvoices || []).length },
    })
  })
}

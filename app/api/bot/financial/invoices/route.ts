import { NextRequest, NextResponse } from 'next/server'
import { withBotAuth, jsonError } from '@/lib/bot/respond'

// Read-only, and deliberately narrow: customer id + name only (for
// matching), invoice/payment/due-date fields, and aging - never
// customer_email, phone, or notes/service details. See docs/HANDOFF.md for
// why Financial Bot's scope stops here.
export async function GET(request: NextRequest) {
  return withBotAuth(request, 'financial_bot', 'GET /api/bot/financial/invoices', async ({ admin }) => {
    const { searchParams } = request.nextUrl
    const status = searchParams.get('status')
    const customerId = searchParams.get('customer_id')
    const unpaidOnly = searchParams.get('unpaid') === 'true'

    let query = admin
      .from('invoices')
      .select('id, invoice_number, customer_id, customer_name, amount, status, due_date, paid_at, paid_via, sales_tax_amount, card_surcharge_amount, created_at')
      .order('created_at', { ascending: false })
      .limit(500)
    if (status) query = query.eq('status', status)
    if (customerId) query = query.eq('customer_id', customerId)
    if (unpaidOnly) query = query.is('paid_at', null)

    const { data, error } = await query
    if (error) return jsonError(500, error.message)
    return NextResponse.json({ invoices: data || [] })
  })
}

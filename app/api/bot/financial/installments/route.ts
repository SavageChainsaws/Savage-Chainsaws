import { NextRequest, NextResponse } from 'next/server'
import { withBotAuth, jsonError } from '@/lib/bot/respond'

// Read-only. Payment-plan invoices are just invoices with
// payment_plan_offered set - there's no separate installments table yet
// (see docs/HANDOFF.md) - so this returns the same narrow, no-contact-info
// invoice shape as /invoices, filtered to that flag.
export async function GET(request: NextRequest) {
  return withBotAuth(request, 'financial_bot', 'GET /api/bot/financial/installments', async ({ admin }) => {
    const { data, error } = await admin
      .from('invoices')
      .select('id, invoice_number, customer_id, customer_name, amount, status, due_date, paid_at, paid_via, created_at')
      .eq('payment_plan_offered', true)
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) return jsonError(500, error.message)
    return NextResponse.json({ installments: data || [] })
  })
}

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendPushToAdmins } from '@/lib/push'
import { unitLabel } from '@/lib/units'

// Called by the customer portal right after it directly writes a unit
// change to Supabase (check-in, add-to-fleet re-check-in, or an
// approve/deny decision) - those writes happen client-side against the
// anon-key client under RLS, which can't hold the VAPID private key, so
// this route does the actual push send server-side. Re-fetches the unit
// through the caller's own cookie-scoped (RLS-enforced) client rather than
// trusting anything from the request body about which unit it is, so a
// customer can only ever trigger a notification about their own unit.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const event = body?.event
  const unitId = body?.unitId
  if (typeof unitId !== 'string' || (event !== 'service_request' && event !== 'decision')) {
    return NextResponse.json({ ok: false, error: 'invalid request' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: unit } = await supabase
    .from('units')
    .select('id, model, equipment_type, nickname, serial_number, customer_id')
    .eq('id', unitId)
    .maybeSingle()
  if (!unit) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
  }

  const { data: customer } = await supabase.from('customers').select('name').eq('id', unit.customer_id).maybeSingle()
  const customerName = customer?.name || 'A customer'
  const label = unitLabel(unit)

  if (event === 'service_request') {
    await sendPushToAdmins({
      title: 'New service request',
      body: `${customerName} submitted ${label}`,
      url: `/?customer=${unit.customer_id}&open=${unit.id}`,
      tag: `unit-${unit.id}`,
    })
  } else {
    const decision = body?.decision === 'approve' ? 'approve' : 'deny'
    await sendPushToAdmins({
      title: decision === 'approve' ? 'Repair approved' : 'Repair denied',
      body: `${customerName} ${decision === 'approve' ? 'approved' : 'denied'} the repair for ${label}`,
      url: `/?customer=${unit.customer_id}&open=${unit.id}`,
      tag: `unit-${unit.id}`,
    })
  }

  return NextResponse.json({ ok: true })
}

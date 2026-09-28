import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toTitleCase } from '@/lib/text'

// Public, unauthenticated endpoint - deliberately so. It exists precisely
// so a customer Jesse just met in person can sign up immediately from a
// link he texts them, with zero admin review step afterward. The only gate
// is the secret `token`, checked against shop_settings.instant_signup_token
// with the service-role client (never exposed to anon/browser) so the
// value can't be read out by probing this route or the DB directly.
//
// Unlike app/signup/page.tsx's admin-reviewed request flow, this route DOES
// create and link a customers row itself. That's safe specifically because
// it always INSERTs a brand-new row from the id createUser() just
// returned - it never looks up or matches an existing customer by email.
// Do not change that: matching by email here would reintroduce the exact
// account-takeover bug documented in app/signup/page.tsx.
export async function POST(req: NextRequest) {
  const adminClient = createAdminClient()
  if (!adminClient) {
    return NextResponse.json(
      { error: 'Signup is not configured yet - contact Savage Chainsaws directly.' },
      { status: 500 }
    )
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const token = ((body.token as string) || '').trim()
  const companyName = toTitleCase(((body.companyName as string) || '').trim())
  const email = ((body.email as string) || '').trim().toLowerCase()
  const phone = ((body.phone as string) || '').trim() || null
  const password = (body.password as string) || ''

  if (!token) {
    return NextResponse.json({ error: 'This signup link is missing its access key.' }, { status: 403 })
  }
  if (!companyName || !email || password.length < 6) {
    return NextResponse.json(
      { error: 'Business name, email, and a password of at least 6 characters are required.' },
      { status: 400 }
    )
  }

  const { data: setting } = await adminClient
    .from('shop_settings')
    .select('value')
    .eq('key', 'instant_signup_token')
    .maybeSingle()
  if (!setting?.value || setting.value !== token) {
    return NextResponse.json(
      { error: 'This signup link is invalid or has expired. Contact Savage Chainsaws for a new one.' },
      { status: 403 }
    )
  }

  const { data: createData, error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { company_name: companyName, phone },
  })
  if (createErr) {
    return NextResponse.json({ error: createErr.message }, { status: 400 })
  }
  const authUserId = createData.user?.id
  if (!authUserId) {
    return NextResponse.json({ error: 'Account creation did not return a user id.' }, { status: 500 })
  }

  const { error: insertErr } = await adminClient.from('customers').insert({
    name: companyName,
    email,
    phone,
    auth_user_id: authUserId,
  })
  if (insertErr) {
    // Auth account exists but isn't linked - clean it up rather than leave
    // a dangling login nobody can fix without direct DB access.
    await adminClient.auth.admin.deleteUser(authUserId)
    return NextResponse.json(
      { error: `Could not finish creating your account: ${insertErr.message}. Please try again.` },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
}

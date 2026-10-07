'use server'

import { revalidatePath } from 'next/cache'
import { getSessionInfo } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toTitleCase, normalizeEmail } from '@/lib/text'
import { sendPushToReferralSource } from '@/lib/push'
import { resolveReferralCode } from '@/lib/referrals'

type CreateLoginState = { success: boolean; message: string; password?: string } | null

function generateDefaultPassword() {
  return `Savage${Math.floor(1000 + Math.random() * 9000)}!`
}

// Admin-controlled account creation - creates the Supabase Auth user
// directly (via the service-role client, since the anon-key client can't
// call auth.admin.createUser) rather than the customer signing up
// themselves. This is the ONLY path that links a customers row to an
// auth_user_id: it sets auth_user_id directly from the id createUser()
// just returned, rather than relying on any email-match lookup, so a
// customers row is never linked to an account nobody here explicitly
// created. Do not reintroduce an email-based auto-link - that was the
// account-takeover vulnerability (see link_customer_account in the DB,
// now admin-only and id-based, and the removed public-signup insert
// policy on customers).
export async function createCustomerLogin(_prevState: CreateLoginState, formData: FormData): Promise<CreateLoginState> {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const emailRaw = ((formData.get('email') as string) || '').trim()
  const email = emailRaw ? normalizeEmail(emailRaw) : ''
  const customerId = (formData.get('customer_id') as string) || ''
  const newCustomerNameRaw = ((formData.get('new_customer_name') as string) || '').trim()
  const newCustomerName = newCustomerNameRaw ? toTitleCase(newCustomerNameRaw) : ''
  const passwordInput = ((formData.get('password') as string) || '').trim()

  if (!email) return { success: false, message: 'Email is required.' }
  if (!customerId && !newCustomerName) {
    return { success: false, message: 'Choose an existing customer or enter a name for a new one.' }
  }

  const adminClient = createAdminClient()
  if (!adminClient) {
    return { success: false, message: 'SUPABASE_SERVICE_ROLE_KEY is not configured yet - cannot create login accounts.' }
  }

  const password = passwordInput || generateDefaultPassword()
  const { data: createData, error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createErr) {
    return { success: false, message: `Could not create account: ${createErr.message}` }
  }
  const authUserId = createData.user?.id
  if (!authUserId) {
    return { success: false, message: 'Account created, but no user id was returned - cannot link it to a customer.' }
  }

  // Referral code, if entered, is resolved before the write below so it can
  // ride along in the same insert (new customer) or be added to the update
  // (existing customer) - never overwrites a referral already on file for
  // an existing customer, same reasoning as the check-in path in addUnit.
  const referralSourceId = await resolveReferralCode(supabase, formData)
  let existingReferralSourceId: string | null = null
  if (customerId) {
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('referral_source_id')
      .eq('id', customerId)
      .maybeSingle()
    existingReferralSourceId = existingCustomer?.referral_source_id ?? null
  }
  const attachReferralId = referralSourceId && !existingReferralSourceId ? referralSourceId : null

  const { error: linkErr } = customerId
    ? await supabase
        .from('customers')
        .update({ email, auth_user_id: authUserId, ...(attachReferralId ? { referral_source_id: attachReferralId } : {}) })
        .eq('id', customerId)
    : await supabase
        .from('customers')
        .insert({ name: newCustomerName, email, auth_user_id: authUserId, referral_source_id: referralSourceId })
  if (linkErr) {
    return {
      success: false,
      message: `Account created, but linking it to the customer record failed: ${linkErr.message}. The login (${email}) exists but won't see any records yet - contact support.`,
    }
  }

  const finalReferralId = customerId ? attachReferralId : referralSourceId
  if (finalReferralId) {
    await sendPushToReferralSource(finalReferralId, {
      title: 'New referral signed up!',
      body: `${customerId ? email : newCustomerName} just signed up using your referral code.`,
      url: '/referrer',
      tag: 'referral-signup',
    })
  }

  revalidatePath('/')
  return {
    success: true,
    message: `Login created for ${email}.`,
    password: passwordInput ? undefined : password,
  }
}

type DeleteLoginState = { success: boolean; message: string } | null

// Companion to createCustomerLogin, for cleaning up test/dummy customers.
// Refuses to run while the customer still has units attached (delete those
// first - units.customer_id has no cascade, so this would otherwise fail
// with a foreign key error) rather than silently deleting someone's real
// service history along with the account. Removes the linked auth account
// through the proper Admin API - never a raw SQL delete on auth.users,
// which skips GoTrue's own cleanup of sessions/identities/refresh tokens.
export async function deleteCustomerLogin(_prevState: DeleteLoginState, formData: FormData): Promise<DeleteLoginState> {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const customerId = (formData.get('customer_id') as string) || ''
  if (!customerId) return { success: false, message: 'Choose a customer.' }

  const { data: customer } = await supabase
    .from('customers')
    .select('id, name, auth_user_id')
    .eq('id', customerId)
    .single()
  if (!customer) return { success: false, message: 'Customer not found.' }

  const { count: unitCount } = await supabase
    .from('units')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customerId)
  if ((unitCount ?? 0) > 0) {
    return { success: false, message: `${customer.name} still has ${unitCount} unit(s) attached - remove those first.` }
  }

  if (customer.auth_user_id) {
    const adminClient = createAdminClient()
    if (!adminClient) {
      return { success: false, message: 'SUPABASE_SERVICE_ROLE_KEY is not configured yet - cannot remove the login account.' }
    }
    const { error: deleteAuthErr } = await adminClient.auth.admin.deleteUser(customer.auth_user_id)
    // A stale customers.auth_user_id pointing at an already-deleted auth
    // account isn't a real failure - nothing to clean up, so fall through
    // to removing the customer row same as if it had never been linked.
    const alreadyGone = deleteAuthErr && (
      (deleteAuthErr as { status?: number }).status === 404 ||
      /not.?found/i.test(deleteAuthErr.message)
    )
    if (deleteAuthErr && !alreadyGone) {
      return { success: false, message: `Could not remove login account: ${deleteAuthErr.message}` }
    }
  }

  const { data: deletedRows, error: deleteCustomerErr } = await supabase
    .from('customers')
    .delete()
    .eq('id', customerId)
    .select('id')
  if (deleteCustomerErr) {
    return { success: false, message: `Could not remove customer record: ${deleteCustomerErr.message}` }
  }
  if (!deletedRows || deletedRows.length === 0) {
    return { success: false, message: `${customer.name} was not removed - the delete affected no rows (likely a permissions issue).` }
  }
  revalidatePath('/')
  return { success: true, message: `${customer.name} removed, along with its login account if it had one.` }
}

type CreateReferralState = { success: boolean; message: string; password?: string } | null

// Mirrors createCustomerLogin above - admin-controlled account creation via
// the service-role client, extensible to any number of referral partners
// through this same form rather than anything hardcoded to one entry.
export async function createReferralSourceLogin(_prevState: CreateReferralState, formData: FormData): Promise<CreateReferralState> {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const nameRaw = ((formData.get('name') as string) || '').trim()
  const name = nameRaw ? toTitleCase(nameRaw) : ''
  const emailRaw = ((formData.get('email') as string) || '').trim()
  const email = emailRaw ? normalizeEmail(emailRaw) : ''
  const phone = ((formData.get('phone') as string) || '').trim() || null
  const codeRaw = ((formData.get('referral_code') as string) || '').trim()
  const passwordInput = ((formData.get('password') as string) || '').trim()

  if (!name) return { success: false, message: 'Partner name is required.' }
  if (!email) return { success: false, message: 'Email is required.' }
  if (!codeRaw) return { success: false, message: 'Referral code is required.' }
  const referralCode = codeRaw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!referralCode) return { success: false, message: 'Referral code must contain letters or numbers.' }

  const adminClient = createAdminClient()
  if (!adminClient) {
    return { success: false, message: 'SUPABASE_SERVICE_ROLE_KEY is not configured yet - cannot create login accounts.' }
  }

  const password = passwordInput || generateDefaultPassword()
  const { data: createData, error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createErr) {
    return { success: false, message: `Could not create account: ${createErr.message}` }
  }
  const authUserId = createData.user?.id
  if (!authUserId) {
    return { success: false, message: 'Account created, but no user id was returned - cannot link it to a referral partner.' }
  }

  const { error: insertErr } = await supabase.from('referral_sources').insert({
    name,
    contact_email: email,
    contact_phone: phone,
    referral_code: referralCode,
    auth_user_id: authUserId,
  })
  if (insertErr) {
    return {
      success: false,
      message: `Account created, but saving the referral partner record failed: ${insertErr.message}. The login (${email}) exists but isn't linked yet - contact support.`,
    }
  }

  revalidatePath('/')
  return {
    success: true,
    message: `Referral partner login created for ${name} (code: ${referralCode}).`,
    password: passwordInput ? undefined : password,
  }
}

type DeleteReferralState = { success: boolean; message: string } | null

// Companion to createReferralSourceLogin. Refuses to run while any customer
// is still linked to this referral source, same reasoning as
// deleteCustomerLogin refusing while units are still attached - detaching
// customers from their referral history isn't this action's job.
export async function deleteReferralSourceLogin(_prevState: DeleteReferralState, formData: FormData): Promise<DeleteReferralState> {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const referralSourceId = (formData.get('referral_source_id') as string) || ''
  if (!referralSourceId) return { success: false, message: 'Choose a referral partner.' }

  const { data: source } = await supabase
    .from('referral_sources')
    .select('id, name, auth_user_id')
    .eq('id', referralSourceId)
    .single()
  if (!source) return { success: false, message: 'Referral partner not found.' }

  const { count: customerCount } = await supabase
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('referral_source_id', referralSourceId)
  if ((customerCount ?? 0) > 0) {
    return { success: false, message: `${source.name} still has ${customerCount} customer(s) linked - this can't be removed while referral history exists.` }
  }

  if (source.auth_user_id) {
    const adminClient = createAdminClient()
    if (!adminClient) {
      return { success: false, message: 'SUPABASE_SERVICE_ROLE_KEY is not configured yet - cannot remove the login account.' }
    }
    const { error: deleteAuthErr } = await adminClient.auth.admin.deleteUser(source.auth_user_id)
    const alreadyGone = deleteAuthErr && (
      (deleteAuthErr as { status?: number }).status === 404 ||
      /not.?found/i.test(deleteAuthErr.message)
    )
    if (deleteAuthErr && !alreadyGone) {
      return { success: false, message: `Could not remove login account: ${deleteAuthErr.message}` }
    }
  }

  const { data: deletedRows, error: deleteErr } = await supabase
    .from('referral_sources')
    .delete()
    .eq('id', referralSourceId)
    .select('id')
  if (deleteErr) {
    return { success: false, message: `Could not remove referral partner record: ${deleteErr.message}` }
  }
  if (!deletedRows || deletedRows.length === 0) {
    return { success: false, message: `${source.name} was not removed - the delete affected no rows (likely a permissions issue).` }
  }
  revalidatePath('/')
  return { success: true, message: `${source.name} removed, along with its login account if it had one.` }
}

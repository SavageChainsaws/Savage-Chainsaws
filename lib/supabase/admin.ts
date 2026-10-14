import { createClient } from '@supabase/supabase-js'

// Service-role client for privileged operations (creating a customer's
// login account, webhook handlers with no logged-in user at all) that the
// anon-key client can't perform under RLS. Only ever call this from a
// server action already gated by isAdmin, or - for a customer-initiated
// write like claimZellePayment - one that's first confirmed ownership of
// the row via a plain RLS-scoped select on the regular client. Never
// import it into client components, since the service role key must never
// reach the browser bundle.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

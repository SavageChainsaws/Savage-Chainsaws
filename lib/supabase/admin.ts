import { createClient } from '@supabase/supabase-js'

// Service-role client for privileged auth operations (creating a customer's
// login account) that the anon-key client can't perform under RLS. Only
// ever call this from server actions already gated by isAdmin - never
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

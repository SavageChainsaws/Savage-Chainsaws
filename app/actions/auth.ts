'use server'

import { createClient } from '@/lib/supabase/server'

// Password sign-in must happen server-side (not via the browser client) so
// the session cookie is set through a real HTTP Set-Cookie header. Safari's
// Intelligent Tracking Prevention caps any cookie written via document.cookie
// (which is how the browser client sets cookies) to 7 days, no matter what
// maxAge is requested - the app's cookie config already asks for ~400 days
// (the @supabase/ssr default), but ITP silently overrides that for a
// client-set cookie. Cookies set from a Server Action/Route Handler aren't
// subject to that cap, which is exactly how the magic-link flow already
// works (session established server-side in app/auth/callback/route.ts) -
// this brings password login in line with it.
export async function signInWithPasswordAction(email: string, password: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.user) {
    return { error: error?.message || 'Login failed. Please try again.', isAdmin: false }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .single()

  return { error: null, isAdmin: profile?.role === 'admin' }
}

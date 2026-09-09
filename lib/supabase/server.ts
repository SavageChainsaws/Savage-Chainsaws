import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Next.js memoizes identical fetch() calls (same URL/options) made during a
// single request/render - great for de-duping data fetches, but it means a
// retried auth check below would otherwise get served the FIRST attempt's
// cached failure instead of actually hitting the network again. `cache:
// 'no-store'` only opts out of the persistent Data Cache, not this
// per-render memoization - per Next.js's own docs, the documented way to
// opt a fetch out of memoization is to give it its own AbortController
// signal, so every Supabase Auth request gets a fresh one here.
function noStoreFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, { ...init, cache: 'no-store', signal: new AbortController().signal })
}

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: noStoreFetch },
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll called from a Server Component - safe to ignore,
            // middleware.ts below handles refreshing the session.
          }
        },
      },
    }
  )
}

// Returns { user, isAdmin } for use in Server Components / Server Actions.
export async function getSessionInfo() {
  const supabase = await createClient()
  let { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    // A backgrounded tab's access token is often already expired by the
    // time it's foregrounded again, and this first getUser() call is what
    // triggers the actual refresh - a transient network blip right at
    // resume time, or this request racing a concurrent refresh from
    // middleware against the same soon-to-rotate refresh token, can make
    // that one attempt fail even though the session is otherwise perfectly
    // valid. Retry once before concluding the user is actually logged out,
    // so backgrounding the app never trades a real session for a login
    // screen over a single flaky check.
    await new Promise(resolve => setTimeout(resolve, 400))
    ;({ data: { user } } = await supabase.auth.getUser())
  }
  if (!user) return { supabase, user: null, isAdmin: false }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  return { supabase, user, isAdmin: profile?.role === 'admin' }
}

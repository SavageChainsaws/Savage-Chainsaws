import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Vercel kills a hung middleware invocation after 25s with a hard 504 - if
// Supabase Auth is ever briefly slow (cold start, transient network blip),
// that turns into every request on the site failing outright instead of
// just this one auth refresh. Bail out well before that limit and let the
// request through unauthenticated-cookie-as-is; the destination page's own
// getSessionInfo()/getUser() call is the real auth check and will catch an
// actually-invalid session on its own, one page load later, without a 504.
const AUTH_CHECK_TIMEOUT_MS = 5000

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refreshes the session cookie if needed - required for SSR auth to work.
  try {
    await Promise.race([
      supabase.auth.getUser(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Supabase auth check timed out in middleware')), AUTH_CHECK_TIMEOUT_MS)
      ),
    ])
  } catch (err) {
    console.error(err)
    return NextResponse.next({ request })
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|images/).*)',
  ],
}

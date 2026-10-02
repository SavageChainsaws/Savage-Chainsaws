'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

// Supabase fires the PASSWORD_RECOVERY auth event exactly once, the moment
// a recovery link's token gets exchanged into a session - regardless of
// which page happened to be loaded when that exchange ran. The app's own
// "Forgot password?" flow on /login always lands on /reset-password
// already (it sets its own redirectTo), but a reset sent straight from the
// Supabase Dashboard's "Send password recovery email" button has no way to
// specify that - it always uses the project's default Site URL, which
// points at the bare app root. Without this listener, that kind of link
// logs the user in with their OLD password still active and silently
// drops them on whatever page the Site URL points at, never prompting a
// new one - mounted globally (see app/layout.tsx) so it catches the event
// no matter where it happens to land.
export default function AuthRecoveryRedirect() {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY' && pathname !== '/reset-password') {
        router.replace('/reset-password')
      }
    })
    return () => subscription.unsubscribe()
  }, [router, pathname])

  return null
}

'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { notifyAuthChangedAcrossTabs } from '@/lib/authTabSync'

const supabase = createClient()

export default function Logout() {
  useEffect(() => {
    const performLogout = async () => {
      await supabase.auth.signOut()
      notifyAuthChangedAcrossTabs()
      // Full page reload (not router.push) so the next page starts with a
      // completely fresh client/session state instead of racing signOut's
      // cookie-clearing against an in-flight soft navigation.
      window.location.href = '/login'
    }

    performLogout()
  }, [])

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <p className="text-white">Logging you out...</p>
    </div>
  )
}
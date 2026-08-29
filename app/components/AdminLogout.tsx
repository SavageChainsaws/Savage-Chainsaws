'use client'

import { createClient } from '@/lib/supabase/client'
import { notifyAuthChangedAcrossTabs } from '@/lib/authTabSync'

const supabase = createClient()

export default function AdminLogout() {
  async function handleLogout() {
    await supabase.auth.signOut()
    notifyAuthChangedAcrossTabs()
    // Full page reload (not router.push) so the next page starts with a
    // completely fresh client/session state instead of racing signOut's
    // cookie-clearing against an in-flight soft navigation.
    window.location.href = '/login'
  }

  return (
    <button
      onClick={handleLogout}
      className="text-sm text-gray-400 hover:text-white transition"
    >
      Log out
    </button>
  )
}

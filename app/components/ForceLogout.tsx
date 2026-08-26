'use client'

import { useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function ForceLogout() {
  useEffect(() => {
    const runLogout = async () => {
      await supabase.auth.signOut()
      window.location.href = '/login'
    }
    runLogout()
  }, [])

  return null
}
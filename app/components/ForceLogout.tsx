'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

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
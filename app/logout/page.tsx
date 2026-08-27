'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

export default function Logout() {
  const router = useRouter()

  useEffect(() => {
    const performLogout = async () => {
      await supabase.auth.signOut()
      router.push('/login')
    }
    
    performLogout()
  }, )

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <p className="text-white">Logging you out...</p>
    </div>
  )
}
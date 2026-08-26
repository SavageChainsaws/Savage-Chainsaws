'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function Logout() {
  const router = useRouter()

  useEffect(() => {
    const logout = async () => {
      await supabase.auth.signOut()
      router.push('/login')
    }
    logout()
  }, )

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <p className="text-white">Logging you out...</p>
    </div>
  )
}
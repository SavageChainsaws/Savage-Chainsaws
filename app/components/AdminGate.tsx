'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

const ADMIN_EMAILS = [
  'jess.baldonado@me.com',
]

export default function AdminGate() {
  const router = useRouter()

  useEffect(() => {
    async function check() {
      const { data } = await supabase.auth.getUser()
      const user = data.user
      const email = user?.email?.toLowerCase() || ''

      if (!user || !email) {
        router.replace('/login')
        return
      }

      if (ADMIN_EMAILS.includes(email)) return

      router.replace('/customer')
    }

    check()
  }, [router])

  return null
}
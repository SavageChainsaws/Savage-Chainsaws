'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const ADMIN_EMAILS = [
  'jess.baldonado@me.com',
]

export default function AdminGate() {
  const router = useRouter()

  useEffect(() => {
    async function check() {
      const { data } = await supabase.auth.getUser()
      const email = data.user?.email?.toLowerCase()
      if (!email) return
      if (ADMIN_EMAILS.includes(email)) return

      const { data: customer } = await supabase
        .from('customers')
        .select('id')
        .or(`email.ilike.${email},auth_user_id.eq.${data.user.id}`)
        .maybeSingle()

      if (customer) {
        router.replace('/customer')
      }
    }

    check()
  }, [router])

  return null
}
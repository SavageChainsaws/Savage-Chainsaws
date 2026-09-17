'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import SiteFooter from '../../components/SiteFooter'
import { notifyAuthChangedAcrossTabs, watchForAuthChangeAcrossTabs } from '@/lib/authTabSync'
import { signInWithPasswordAction } from '../../actions/auth'

const supabase = createClient()

// Referral partner portal login - a third, distinct login surface from
// /login (admin) and /customer/login (customer), password-only (partners
// are a handful of hand-picked accounts an admin sets up, not a public
// self-service flow, so magic-link/signup aren't needed here).
export default function ReferrerLogin() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const formInProgressRef = useRef(false)

  const redirectIfSignedIn = useCallback(async () => {
    if (formInProgressRef.current) return
    let { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      await new Promise(resolve => setTimeout(resolve, 400))
      if (formInProgressRef.current) return
      ;({ data: { user } } = await supabase.auth.getUser())
    }
    if (!user || formInProgressRef.current) return
    const { data: source } = await supabase.from('referral_sources').select('id').eq('auth_user_id', user.id).maybeSingle()
    if (formInProgressRef.current) return
    if (!source) return
    router.push('/referrer')
    router.refresh()
  }, [router])

  useEffect(() => {
    redirectIfSignedIn()
    return watchForAuthChangeAcrossTabs(redirectIfSignedIn)
  }, [redirectIfSignedIn])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    formInProgressRef.current = true
    setError('')
    setLoading(true)

    const result = await signInWithPasswordAction(email.trim(), password)
    if (result.error) {
      setError(result.error)
      setLoading(false)
      formInProgressRef.current = false
      return
    }
    notifyAuthChangedAcrossTabs()
    router.push('/referrer')
    router.refresh()
  }

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-3">
          <img
            src="/images/logo.png"
            alt="Savage Chainsaws"
            className="h-16 w-16 mx-auto object-contain"
          />
          <h1 className="text-2xl font-bold tracking-tight">
            SAVAGE <span className="text-orange-500">CHAINSAWS</span>
          </h1>
          <p className="text-sm text-gray-400">Referral partner login</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => { setEmail(e.target.value); formInProgressRef.current = e.target.value.length > 0 || password.length > 0 }}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-500"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={e => { setPassword(e.target.value); formInProgressRef.current = email.length > 0 || e.target.value.length > 0 }}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-500"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition"
          >
            {loading ? 'Signing in...' : 'Log in'}
          </button>
        </form>
        <SiteFooter />
      </div>
    </main>
  )
}

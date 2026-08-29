'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import SiteFooter from '../components/SiteFooter'
import { notifyAuthChangedAcrossTabs, watchForAuthChangeAcrossTabs } from '@/lib/authTabSync'

const supabase = createClient()

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [showForgot, setShowForgot] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const [resetError, setResetError] = useState('')

  // Mirrors of email/password/loading, read (not subscribed to) by the
  // cross-tab watcher below so it doesn't need to re-subscribe on every
  // keystroke - it just needs the latest value at the moment it fires.
  const formInProgressRef = useRef(false)

  // If a customer finishes a password reset (or logs in) in a second tab -
  // e.g. one their email client opened for the reset link - this tab wakes
  // up and redirects instead of sitting stale on the old logged-out form.
  // Never fires while this tab has its own login attempt in progress - a
  // stale/leftover session from a previous account must not be able to
  // hijack someone actively typing different credentials here.
  const redirectIfSignedIn = useCallback(async () => {
    if (formInProgressRef.current) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    if (formInProgressRef.current) return
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (formInProgressRef.current) return
    router.push(profile?.role === 'admin' ? '/' : '/customer')
    router.refresh()
  }, [router])

  useEffect(() => watchForAuthChangeAcrossTabs(redirectIfSignedIn), [redirectIfSignedIn])

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault()
    setResetError('')
    setResetLoading(true)
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    })
    setResetLoading(false)
    if (resetErr) {
      setResetError(resetErr.message)
      return
    }
    // Supabase intentionally doesn't reveal whether the email matched an
    // account here, to avoid leaking which emails are registered - so this
    // same message shows either way.
    setResetSent(true)
  }

  function markFormInProgress(nextEmail: string, nextPassword: string) {
    formInProgressRef.current = nextEmail.trim().length > 0 || nextPassword.length > 0
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    formInProgressRef.current = true
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError('Login failed. Please try again.')
      setLoading(false)
      return
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    notifyAuthChangedAcrossTabs()
    router.push(profile?.role === 'admin' ? '/' : '/customer')
    router.refresh()
  }

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/images/logo.png" alt="Savage Chainsaws" className="h-16 mx-auto mb-4" />
          <h1 className="text-2xl font-bold">
            SAVAGE <span className="text-orange-500">CHAINSAWS</span>
          </h1>
          <p className="text-gray-400 mt-1 text-sm">Customer Login</p>
        </div>
        <form onSubmit={handleLogin} className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); markFormInProgress(e.target.value, password) }}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-orange-500"
              placeholder="you@company.com"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Password</label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); markFormInProgress(email, e.target.value) }}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-orange-500"
              placeholder="Your password"
            />
            <div className="text-right mt-1.5">
              <button
                type="button"
                onClick={() => {
                  setShowForgot(!showForgot)
                  setResetError('')
                  setResetSent(false)
                }}
                className="text-xs text-orange-400 hover:text-orange-300"
              >
                Forgot password?
              </button>
            </div>
          </div>
          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition"
          >
            {loading ? 'Logging in...' : 'Log In'}
          </button>

          {showForgot && (
            <div className="border-t border-zinc-800 pt-4 space-y-2">
              {resetSent ? (
                <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">
                  If an account exists for that email, we&apos;ve sent a password reset link. Check your email (and spam folder).
                </p>
              ) : (
                <>
                  <p className="text-xs text-gray-500">
                    We&apos;ll email a reset link to the address entered above.
                  </p>
                  {resetError && (
                    <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                      {resetError}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={resetLoading || !email.trim()}
                    className="w-full border border-zinc-700 hover:bg-zinc-800 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition"
                  >
                    {resetLoading ? 'Sending...' : 'Send password reset link'}
                  </button>
                </>
              )}
            </div>
          )}

          <p className="text-center text-sm text-gray-500">
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="text-orange-400 hover:text-orange-300">
              Sign up
            </Link>
          </p>
        </form>
        <SiteFooter />
      </div>
    </main>
  )
}

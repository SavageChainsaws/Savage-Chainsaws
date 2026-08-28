'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import SiteFooter from '../components/SiteFooter'

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

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
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
              onChange={(e) => setEmail(e.target.value)}
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
              onChange={(e) => setPassword(e.target.value)}
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

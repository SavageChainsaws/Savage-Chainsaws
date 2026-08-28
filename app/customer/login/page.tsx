'use client'

import { useState, useEffect, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import SiteFooter from '../../components/SiteFooter'

const supabase = createClient()

// useSearchParams() requires a Suspense boundary to opt this one small
// piece out of static prerendering, so it's split out from the page body.
function LinkExpiredNotice({ onError }: { onError: (message: string) => void }) {
  const searchParams = useSearchParams()
  useEffect(() => {
    if (searchParams.get('error') === 'link_expired') {
      onError('That login link expired or was already used. Request a new one below.')
    }
  }, [searchParams, onError])
  return null
}

export default function CustomerLogin() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [linkSent, setLinkSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSendLink(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/customer`,
      },
    })

    setLoading(false)
    if (otpError) {
      setError(otpError.message)
      return
    }
    setLinkSent(true)
  }

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (signInError) {
      setError(signInError.message)
      setLoading(false)
      return
    }
    router.push('/customer')
    router.refresh()
  }

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center p-4">
      <Suspense fallback={null}>
        <LinkExpiredNotice onError={setError} />
      </Suspense>
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
          <p className="text-sm text-gray-400">Customer portal login</p>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
          {linkSent ? (
            <div className="text-center space-y-3">
              <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-3">
                Check your email - we sent a login link to <span className="text-white">{email.trim()}</span>.
                Click it to open your portal.
              </p>
              <button
                type="button"
                onClick={() => {
                  setLinkSent(false)
                  setError('')
                }}
                className="text-sm text-gray-400 hover:text-white"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <>
              <form onSubmit={handleSendLink} className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-500"
                    placeholder="you@company.com"
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
                  {loading ? 'Sending...' : 'Email me a login link'}
                </button>
              </form>

              <button
                type="button"
                onClick={() => {
                  setShowPassword(!showPassword)
                  setError('')
                }}
                className="w-full text-sm text-gray-400 hover:text-white"
              >
                {showPassword ? 'Hide password login' : 'Have a password? Log in with password instead'}
              </button>

              {showPassword && (
                <form onSubmit={handlePasswordLogin} className="space-y-4 border-t border-zinc-800 pt-4">
                  <div>
                    <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">
                      Password
                    </label>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-500"
                      placeholder="••••••••"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full border border-zinc-700 hover:bg-zinc-800 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition"
                  >
                    {loading ? 'Please wait...' : 'Log in with password'}
                  </button>
                </form>
              )}
            </>
          )}
        </div>

        <p className="text-center text-sm text-gray-400">
          New customer?{' '}
          <Link href="/signup" className="text-orange-400 hover:text-orange-300">
            Create account
          </Link>
        </p>
        <SiteFooter />
      </div>
    </main>
  )
}

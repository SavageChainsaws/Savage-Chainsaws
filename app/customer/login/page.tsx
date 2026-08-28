'use client'

import { useState, useEffect, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import SiteFooter from '../../components/SiteFooter'

const supabase = createClient()

// Supabase doesn't expose a stable error code across SDK versions for this,
// so we match on status/message. Rate-limit errors are the ones customers
// hit hardest (double-clicking "send" or trying resend right away), and the
// raw message ("For security purposes, you can only request this after Ns")
// reads like a developer error, not something a customer expects.
function getFriendlyOtpError(err: unknown): string {
  const status = (err as { status?: number })?.status
  const code = ((err as { code?: string })?.code || '').toLowerCase()
  const message = ((err as { message?: string })?.message || '').toLowerCase()
  const isRateLimited =
    status === 429 ||
    code.includes('rate_limit') ||
    message.includes('rate limit') ||
    message.includes('security purposes')
  if (isRateLimited) {
    return "You've requested a login link recently. For security we limit how often we can send one - please wait about a minute and try again. Also worth checking your spam/junk folder for the earlier email."
  }
  return (err as { message?: string })?.message || 'Could not send a login link. Please try again in a moment.'
}

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

  async function sendLoginLink(targetEmail: string) {
    setError('')
    setLoading(true)

    // Check the email belongs to a known customer before sending anything -
    // otherwise a typo'd or unregistered address still shows "check your
    // email" even though nothing was actually sent.
    const { data: knownEmail, error: lookupError } = await supabase.rpc('customer_email_exists', {
      check_email: targetEmail,
    })
    if (lookupError) {
      setError('Could not verify that email right now. Please try again in a moment.')
      setLoading(false)
      return
    }
    if (!knownEmail) {
      setError("We don't have an account for that email. Double-check for typos, or create a new account below.")
      setLoading(false)
      return
    }

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: targetEmail,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/customer`,
      },
    })

    setLoading(false)
    if (otpError) {
      setError(getFriendlyOtpError(otpError))
      return
    }
    setLinkSent(true)
  }

  async function handleSendLink(e: React.FormEvent) {
    e.preventDefault()
    await sendLoginLink(email.trim())
  }

  async function handleResend() {
    await sendLoginLink(email.trim())
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
              <p className="text-xs text-gray-500">
                Don&apos;t see it? Check your spam/junk folder, or resend below.
              </p>

              {error && (
                <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button
                type="button"
                onClick={handleResend}
                disabled={loading}
                className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition"
              >
                {loading ? 'Resending...' : 'Resend login link'}
              </button>

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
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full border border-zinc-700 hover:bg-zinc-800 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition"
                  >
                    {loading ? 'Please wait...' : 'Log in with password'}
                  </button>

                  {showForgot && (
                    <div className="border-t border-zinc-800 pt-3 space-y-2">
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

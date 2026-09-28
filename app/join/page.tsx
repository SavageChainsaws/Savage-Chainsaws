'use client'

import { Suspense, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import SiteFooter from '../components/SiteFooter'
import { signInWithPasswordAction } from '../actions/auth'
import { notifyAuthChangedAcrossTabs } from '@/lib/authTabSync'

// Gated by a secret `key` query param (see the Instant Customer Signup Link
// admin section in app/page.tsx / app/api/instant-signup/route.ts). No key,
// no form - this is deliberately the "if they don't have the link, they
// can't sign up" path Jesse asked for, distinct from app/signup/page.tsx's
// open, admin-reviewed request form. A valid key skips admin review
// entirely: the account is created and usable immediately.
function TokenFromQuery({ onToken }: { onToken: (token: string) => void }) {
  const searchParams = useSearchParams()
  const applied = useRef(false)
  if (!applied.current) {
    applied.current = true
    onToken(searchParams.get('key') || '')
  }
  return null
}

export default function JoinPage() {
  const [token, setToken] = useState<string | null>(null)
  const [companyName, setCompanyName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const res = await fetch('/api/instant-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        companyName: companyName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        password,
      }),
    })
    const body = await res.json()
    if (!res.ok) {
      setError(body.error || 'Something went wrong. Please try again.')
      setLoading(false)
      return
    }

    const result = await signInWithPasswordAction(email.trim().toLowerCase(), password)
    if (result.error) {
      // Account was created successfully - a sign-in hiccup right after
      // shouldn't strand them on an error page with no way forward.
      setError(`Account created! ${result.error} Try logging in from the login page.`)
      setLoading(false)
      return
    }
    notifyAuthChangedAcrossTabs()
    router.push('/customer')
    router.refresh()
  }

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center p-4">
      <Suspense fallback={null}>
        <TokenFromQuery onToken={setToken} />
      </Suspense>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/images/logo.png" alt="Savage Chainsaws" className="h-16 w-16 mx-auto object-contain mb-4" />
          <h1 className="text-2xl font-bold tracking-tight">
            SAVAGE <span className="text-orange-500">CHAINSAWS</span>
          </h1>
          <p className="text-gray-400 text-sm mt-1">Create Your Account</p>
        </div>

        {token === null ? null : !token ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-3 text-center">
            <h2 className="text-lg font-semibold">Invite Link Required</h2>
            <p className="text-sm text-gray-400">
              This signup page needs a valid invite link. If Savage Chainsaws texted or gave you a link, please use
              that exact link.
            </p>
            <Link
              href="/login"
              className="inline-block mt-2 bg-orange-600 hover:bg-orange-500 text-white font-medium py-2.5 px-6 rounded-lg transition"
            >
              Back to Login
            </Link>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4"
          >
            <p className="text-xs text-gray-500 bg-zinc-800/80 rounded-lg px-3 py-2">
              Your account is created and ready to use right away - no waiting on approval.
            </p>

            <div>
              <label className="block text-sm font-medium text-orange-400 mb-1.5">Business / Company Name *</label>
              <input
                type="text"
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Davey Tree, Signature Landscaping"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Email *</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Phone Number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(407) 555-1234"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Password *</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a password"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-500"
              />
              <p className="text-xs text-gray-500 mt-1">Must be at least 6 characters</p>
            </div>

            {error && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg transition"
            >
              {loading ? 'Creating account…' : 'Create Account'}
            </button>

            <p className="text-center text-sm text-gray-400">
              Already have an account?{' '}
              <Link href="/login" className="text-orange-400 hover:text-orange-300">
                Log in
              </Link>
            </p>
          </form>
        )}
        <SiteFooter />
      </div>
    </main>
  )
}

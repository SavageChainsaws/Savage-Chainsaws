'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import SiteFooter from '../components/SiteFooter'
import { toTitleCase } from '@/lib/text'

// useSearchParams() requires a Suspense boundary to opt this one small
// piece out of static prerendering (same pattern as
// app/customer/login/page.tsx's LinkExpiredNotice). onCode is a plain
// function recreated on every SignupPage render (not a stable setState
// setter), so a ref guards against re-applying the query value - and
// re-running validation - on every keystroke elsewhere in the form.
function ReferralCodeFromQuery({ onCode }: { onCode: (code: string) => void }) {
  const searchParams = useSearchParams()
  const applied = useRef(false)
  useEffect(() => {
    if (applied.current) return
    const ref = searchParams.get('ref')
    if (ref) {
      applied.current = true
      onCode(ref)
    }
  }, [searchParams, onCode])
  return null
}

// Public signup creates an Auth user ONLY - it never creates or links a
// customers row. That linking (setting customers.auth_user_id) is done
// exclusively by an admin via "Create Customer Login" in app/page.tsx,
// which sets it directly from the id it just created. This is deliberate:
// a self-service signup used to also insert/match a customers row by
// email with no verification, which let anyone claim an existing
// company's account just by typing their email address. Do not restore
// that - see the account-takeover fix this replaced.
export default function SignupPage() {
  const [companyName, setCompanyName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [referralCode, setReferralCode] = useState('')
  const [referralNote, setReferralNote] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState<{ needsConfirmation: boolean } | null>(null)

  const supabase = createClient()

  // Pre-fills from a referral partner's link (e.g. /signup?ref=ELVIS) and
  // immediately checks it against referral_sources via a public, boolean-
  // only RPC (validate_referral_code) - anon has no direct read access to
  // that table, and this never blocks signup either way, just lets a bad/
  // stale link show a small note instead of silently doing nothing.
  async function handleReferralFromQuery(code: string) {
    setReferralCode(code)
    const { data: isValid } = await supabase.rpc('validate_referral_code', { p_code: code })
    if (!isValid) {
      setReferralNote("That referral link wasn't recognized - you can still request an account without it.")
    }
  }

  function handleReferralCodeChange(value: string) {
    setReferralCode(value)
    setReferralNote(null)
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const cleanEmail = email.trim().toLowerCase()
    const cleanName = toTitleCase(companyName.trim())
    const cleanPhone = phone.trim() || null
    const trimmedReferralCode = referralCode.trim()

    if (!cleanName) {
      setError('Business / company name is required.')
      setLoading(false)
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      setLoading(false)
      return
    }

    // Validated again here (not just trusted from the earlier query-param
    // check) since this also covers a code typed or edited by hand -
    // invalid/unknown just means it's left off, never a blocked signup.
    let validatedReferralCode: string | null = null
    if (trimmedReferralCode) {
      const { data: isValid } = await supabase.rpc('validate_referral_code', { p_code: trimmedReferralCode })
      validatedReferralCode = isValid ? trimmedReferralCode.toUpperCase() : null
    }

    const { data, error: authError } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: {
          company_name: cleanName,
          phone: cleanPhone,
          referral_code: validatedReferralCode,
        },
      },
    })

    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }

    // Never grant portal access from this flow - only an admin creating a
    // login (Create Customer Login) links an account to real data. If
    // email confirmation is off at the project level this may still return
    // an active session; sign it out immediately so nobody is left with a
    // dangling authenticated-but-unlinked session.
    if (data.session) {
      await supabase.auth.signOut()
    }

    setSubmitted({ needsConfirmation: !data.session })
    setLoading(false)
  }

  if (submitted) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          <img
            src="/images/logo.png"
            alt="Savage Chainsaws"
            className="h-16 w-16 mx-auto object-contain mb-4"
          />
          <h1 className="text-2xl font-bold tracking-tight mb-6">
            SAVAGE <span className="text-orange-500">CHAINSAWS</span>
          </h1>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-3">
            <h2 className="text-lg font-semibold">Request Received</h2>
            <p className="text-sm text-gray-400">
              {submitted.needsConfirmation
                ? 'Check your email and click the confirmation link to verify your address. '
                : ''}
              An admin will review your request and set up your portal access - you&apos;ll
              be notified once it&apos;s ready.
            </p>
            <Link
              href="/login"
              className="inline-block mt-2 bg-orange-600 hover:bg-orange-500 text-white font-medium py-2.5 px-6 rounded-lg transition"
            >
              Back to Login
            </Link>
          </div>
          <SiteFooter />
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center p-4">
      <Suspense fallback={null}>
        <ReferralCodeFromQuery onCode={handleReferralFromQuery} />
      </Suspense>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img
            src="/images/logo.png"
            alt="Savage Chainsaws"
            className="h-16 w-16 mx-auto object-contain mb-4"
          />
          <h1 className="text-2xl font-bold tracking-tight">
            SAVAGE <span className="text-orange-500">CHAINSAWS</span>
          </h1>
          <p className="text-gray-400 text-sm mt-1">Request a Customer Account</p>
        </div>

        <form
          onSubmit={handleSignup}
          className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-orange-400 mb-1.5">
              Business / Company Name *
            </label>
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

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Referral Code (optional)</label>
            <input
              type="text"
              value={referralCode}
              onChange={(e) => handleReferralCodeChange(e.target.value)}
              placeholder="e.g. ELVIS"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm uppercase focus:outline-none focus:border-orange-500"
            />
            {referralNote && (
              <p className="text-xs text-gray-500 mt-1">{referralNote}</p>
            )}
          </div>

          <p className="text-xs text-gray-500 bg-zinc-800/80 rounded-lg px-3 py-2">
            This submits a request only - an admin reviews every new account and sets up
            your portal access before you can log in.
          </p>

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
            {loading ? 'Submitting…' : 'Request Account'}
          </button>

          <p className="text-center text-sm text-gray-400">
            Already have an account?{' '}
            <Link href="/login" className="text-orange-400 hover:text-orange-300">
              Log in
            </Link>
          </p>
        </form>
        <SiteFooter />
      </div>
    </main>
  )
}

'use client'
import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function SignUpPage() {
  const router = useRouter()
  const [companyName, setCompanyName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    // 1. Create the auth user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    })

    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }

    if (!authData.user) {
      setError('Something went wrong creating the account.')
      setLoading(false)
      return
    }

    // 2. Check if a customer with this email already exists
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    if (existingCustomer) {
      // Link the existing customer to this auth user
      await supabase
        .from('customers')
        .update({ 
          auth_user_id: authData.user.id,
          phone: phone || null
        })
        .eq('id', existingCustomer.id)
    } else {
      // Create a new customer record
      await supabase.from('customers').insert({
        name: companyName,
        email: email,
        phone: phone || null,
        auth_user_id: authData.user.id,
      })
    }

    setSuccess(true)
    setLoading(false)

    // Redirect to customer portal after a short delay
    setTimeout(() => {
      router.push('/customer')
    }, 1500)
  }

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/images/logo.png" alt="Savage Chainsaws" className="h-16 mx-auto mb-4" />
          <h1 className="text-2xl font-bold">
            SAVAGE <span className="text-orange-500">CHAINSAWS</span>
          </h1>
          <p className="text-gray-400 mt-1 text-sm">Create Your Customer Account</p>
        </div>

        {success ? (
          <div className="bg-green-500/10 border border-green-500/40 rounded-xl p-6 text-center">
            <p className="text-green-400 font-medium text-lg">Account created!</p>
            <p className="text-gray-400 text-sm mt-2">Jesse has been notified. Redirecting you now...</p>
          </div>
        ) : (
          <form onSubmit={handleSignUp} className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
            
            {/* Company Name - more prominent */}
            <div>
              <label className="block text-sm font-medium text-orange-400 mb-1">
                Business / Company Name *
              </label>
              <input
                type="text"
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-orange-500"
                placeholder="e.g. Davey Tree, Signature Landscaping"
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Email *</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-orange-500"
                placeholder="you@company.com"
              />
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Phone Number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-orange-500"
                placeholder="(407) 555-1234"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Password *</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-orange-500"
                placeholder="Create a password"
              />
              <p className="text-xs text-gray-500 mt-1">Must be at least 6 characters</p>
            </div>

            {/* Note */}
            <p className="text-xs text-gray-500 bg-zinc-800/50 rounded-lg p-3">
              Jesse will be notified when you create this account so he can start adding your units.
            </p>

            {error && (
              <p className="text-red-400 text-sm">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition"
            >
              {loading ? 'Creating your account...' : 'Create Account & Continue'}
            </button>

            <p className="text-center text-sm text-gray-500">
              Already have an account?{' '}
              <Link href="/login" className="text-orange-400 hover:text-orange-300">
                Log in
              </Link>
            </p>
          </form>
        )}
      </div>
    </main>
  )
}
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import PushToggle from '../components/PushToggle'
import SiteFooter from '../components/SiteFooter'
import CopyReferralLink from '../components/CopyReferralLink'
import { notifyAuthChangedAcrossTabs } from '@/lib/authTabSync'

const supabase = createClient()

type ReferralSource = {
  id: string
  name: string
  referral_code: string
}

// Matches get_referred_customers()'s return columns exactly (see the
// add_referral_sources migration) - a SECURITY DEFINER RPC, not raw table
// access, so this portal only ever sees these five fields for customers
// actually referred by this account, never anyone else's data and never
// email/phone/financial detail beyond the discount flag.
type ReferredCustomer = {
  id: string
  name: string
  created_at: string
  active_unit_count: number
  discount_used: boolean
}

export default function ReferrerPortal() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState<ReferralSource | null>(null)
  const [customers, setCustomers] = useState<ReferredCustomer[]>([])
  const [error, setError] = useState<string | null>(null)

  async function loadData() {
    setLoading(true)
    setError(null)
    let { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      await new Promise(resolve => setTimeout(resolve, 400))
      ;({ data: { user } } = await supabase.auth.getUser())
    }
    if (!user) {
      router.push('/referrer/login')
      return
    }

    const { data: src } = await supabase
      .from('referral_sources')
      .select('id, name, referral_code')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    if (!src) {
      setSource(null)
      setLoading(false)
      return
    }
    setSource(src)

    const { data: referred, error: rpcError } = await supabase.rpc('get_referred_customers')
    if (rpcError) {
      setError('Could not load your referrals right now. Try refreshing.')
    } else {
      setCustomers(referred || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    // Same fetch-on-mount pattern as app/customer/page.tsx's loadData -
    // loadData sets its own loading/error/data state as it goes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData()
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    notifyAuthChangedAcrossTabs()
    window.location.href = '/referrer/login'
  }

  function statusFor(c: ReferredCustomer): { label: string; colorClass: string } {
    if (c.active_unit_count > 0) {
      return {
        label: `Active - ${c.active_unit_count} unit${c.active_unit_count === 1 ? '' : 's'} in shop`,
        colorClass: 'bg-green-500/20 text-green-400',
      }
    }
    return { label: 'Signed up, no units yet', colorClass: 'bg-zinc-700 text-gray-300' }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </main>
    )
  }

  if (!source) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white p-6">
        <div className="max-w-lg mx-auto mt-20 text-center space-y-4">
          <img src="/images/logo.png" alt="Savage Chainsaws" className="h-16 w-16 mx-auto object-contain" />
          <h1 className="text-2xl font-bold">
            SAVAGE <span className="text-orange-500">CHAINSAWS</span>
          </h1>
          <p className="text-gray-400">No referral partner account is linked to this login yet.</p>
          <button
            onClick={handleLogout}
            className="mt-4 border border-zinc-700 rounded-lg px-4 py-2 text-sm hover:bg-zinc-800"
          >
            Log out
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-zinc-800 px-4 sm:px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img
              src="/images/logo.png"
              alt="Savage Chainsaws"
              className="h-10 w-10 object-contain rounded-lg bg-zinc-900 border border-zinc-700"
            />
            <div>
              <p className="font-bold text-lg leading-tight">{source.name}</p>
              <p className="text-xs text-gray-500">
                Referral partner - <span className="text-orange-400">Savage Chainsaws</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <PushToggle label="Alerts" />
            <button
              onClick={handleLogout}
              className="border border-zinc-700 rounded-lg px-3 py-1.5 hover:bg-zinc-800 transition"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Your referral code</p>
          <p className="text-3xl font-bold text-orange-400 font-mono">{source.referral_code}</p>
          <p className="text-sm text-gray-400 mt-1">
            Share this code with people you send our way - they mention it when they sign up or check in their first unit.
          </p>
          <div className="mt-3 pt-3 border-t border-zinc-800">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1.5">Or just send your link</p>
            <CopyReferralLink code={source.referral_code} />
            <p className="text-xs text-gray-500 mt-1.5">
              Anyone who signs up from this link has your code filled in automatically - nothing for them to type.
            </p>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-orange-400">Your referrals</h2>
              <p className="text-xs text-gray-500 mt-1">Everyone who signed up using your code.</p>
            </div>
            <span className="text-sm text-gray-400">{customers.length} total</span>
          </div>
          <div className="divide-y divide-zinc-800">
            {customers.map(c => {
              const status = statusFor(c)
              return (
                <div key={c.id} className="px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{c.name}</p>
                    <p className="text-xs text-gray-500">
                      Signed up {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {c.discount_used ? ' · First-service discount used' : ' · First-service discount not yet used'}
                    </p>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap ${status.colorClass}`}>
                    {status.label}
                  </span>
                </div>
              )
            })}
            {customers.length === 0 && (
              <p className="px-4 sm:px-6 py-8 text-gray-500 text-center text-sm">
                No referrals yet - once someone signs up with your code, they&apos;ll show up here.
              </p>
            )}
          </div>
        </div>

        <SiteFooter />
      </div>
    </main>
  )
}

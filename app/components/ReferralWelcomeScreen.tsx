'use client'

// Full-screen, one-time branded welcome moment for a customer who signed up
// or checked in using a valid referral code - shown before they continue
// into their normal dashboard, never as a small inline toast (per the
// referral partner feature spec). Deliberately never says "VIP" - kept to
// "premier customer" framing throughout.
export default function ReferralWelcomeScreen({
  referrerName,
  referrerContact,
  busy,
  onContinue,
}: {
  referrerName: string
  referrerContact: string | null
  busy: boolean
  onContinue: () => void
}) {
  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center p-4">
      <div className="w-full max-w-lg text-center space-y-6">
        <img
          src="/images/logo.png"
          alt="Savage Chainsaws"
          className="h-20 w-20 mx-auto object-contain"
        />
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">
            SAVAGE <span className="text-orange-500">CHAINSAWS</span>
          </h1>
          <p className="text-orange-400 font-semibold text-lg">Welcome!</p>
        </div>

        <div className="bg-zinc-900 border border-orange-500/40 rounded-2xl p-6 space-y-4 text-left">
          <p className="text-base text-gray-200 leading-relaxed">
            You&apos;ve been signed up as one of our <span className="text-white font-semibold">premier customers</span> through{' '}
            <span className="text-orange-400 font-semibold">{referrerName}</span>. Jesse will be reaching out to you personally.
          </p>
          {referrerContact && (
            <p className="text-sm text-gray-400 leading-relaxed">
              If you have any questions before then, feel free to reach out to{' '}
              <span className="text-white font-medium">{referrerName}</span> directly at{' '}
              <span className="text-orange-400">{referrerContact}</span>.
            </p>
          )}
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-3">
            <p className="text-orange-300 font-bold text-lg">Your first service includes 10% off.</p>
          </div>
        </div>

        <button
          onClick={onContinue}
          disabled={busy}
          className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-60 text-white font-medium py-3 rounded-lg transition"
        >
          {busy ? 'Loading...' : 'Continue to my dashboard'}
        </button>
      </div>
    </main>
  )
}

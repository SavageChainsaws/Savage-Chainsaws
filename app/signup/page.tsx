import Link from 'next/link'
import SiteFooter from '../components/SiteFooter'

// Public self-service signup is paused during a security audit (unverified
// email + auto-link-by-email allowed account takeover of customer records
// created without a login). Do not re-enable by restoring the old signUp()
// flow without fixing that first - see the audit findings.
export default function SignupPage() {
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
          <h2 className="text-lg font-semibold">Signups Temporarily Paused</h2>
          <p className="text-sm text-gray-400">
            New account creation is paused for a short maintenance window. If you
            already have an account, you can still log in below. Otherwise, please
            check back shortly or contact us directly to get set up.
          </p>
          <Link
            href="/login"
            className="inline-block mt-2 bg-orange-600 hover:bg-orange-500 text-white font-medium py-2.5 px-6 rounded-lg transition"
          >
            Log In
          </Link>
        </div>
        <SiteFooter />
      </div>
    </main>
  )
}

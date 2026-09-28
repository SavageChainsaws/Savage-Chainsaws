import { getSessionInfo } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import CopyableSignupLink from '../components/CopyableSignupLink'
import AdminLogout from '../components/AdminLogout'

export default async function SettingsPage() {
  const { user, isAdmin } = await getSessionInfo()
  if (!user || !isAdmin) redirect('/login')

  // Fetch recent signups from auth.users that haven't been linked to a customer
  let recentSignups: any[] = []
  try {
    const admin = createAdminClient()
    if (admin) {
      const { data: authUsers } = await admin.auth.admin.listUsers()
      if (authUsers) {
        // Sort by created_at descending and take the 10 most recent
        recentSignups = authUsers
          .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 10)
          .map((u: any) => ({
            id: u.id,
            email: u.email,
            company_name: u.user_metadata?.company_name || 'N/A',
            phone: u.user_metadata?.phone || null,
            referral_code: u.user_metadata?.referral_code || null,
            created_at: u.created_at,
          }))
      }
    }
  } catch (error) {
    console.error('Error fetching recent signups:', error)
  }

  return (
    <main className="min-h-screen bg-black text-white">
      {/* Top Navigation */}
      <div className="border-b border-zinc-800 bg-zinc-900/50 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">
              SAVAGE <span className="text-orange-500">CHAINSAWS</span>
            </h1>
            <p className="text-sm text-gray-400">Settings & Links</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="border border-zinc-600 hover:border-orange-500 text-xs px-3 py-1.5 rounded-lg"
            >
              Back to Dashboard
            </Link>
            <AdminLogout />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {/* Signup Link Section */}
        <div className="border border-orange-500/30 rounded-xl p-6 bg-orange-500/[0.03] space-y-4">
          <div>
            <h2 className="text-xl font-bold text-orange-400 mb-2">Quick Signup Link</h2>
            <p className="text-sm text-gray-400">
              Copy this link to text to prospects and generate leads. Share it quickly on job sites!
            </p>
          </div>
          <CopyableSignupLink />
        </div>

        {/* Recent Signups Section */}
        <div className="border border-blue-500/30 rounded-xl p-6 bg-blue-500/[0.03] space-y-4">
          <div>
            <h2 className="text-xl font-bold text-blue-400 mb-2">Recent Signup Requests</h2>
            <p className="text-sm text-gray-400">
              Latest accounts requesting access. Use "Create Customer Login" in the main dashboard to approve them.
            </p>
          </div>

          {recentSignups.length === 0 ? (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 text-center text-gray-400">
              No recent signups yet
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-blue-500/30 text-blue-300">
                    <th className="text-left py-2 px-2 font-semibold">Company Name</th>
                    <th className="text-left py-2 px-2 font-semibold">Email</th>
                    <th className="text-left py-2 px-2 font-semibold">Phone</th>
                    <th className="text-left py-2 px-2 font-semibold">Ref Code</th>
                    <th className="text-left py-2 px-2 font-semibold">Signed Up</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSignups.map((signup) => (
                    <tr key={signup.id} className="border-b border-zinc-800 hover:bg-blue-500/5 transition">
                      <td className="py-2 px-2 text-blue-100 font-medium">{signup.company_name}</td>
                      <td className="py-2 px-2 text-gray-300">{signup.email}</td>
                      <td className="py-2 px-2 text-gray-400">{signup.phone || '—'}</td>
                      <td className="py-2 px-2 text-gray-400">
                        {signup.referral_code ? (
                          <span className="bg-orange-500/20 text-orange-300 px-2 py-1 rounded text-xs">
                            {signup.referral_code}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2 px-2 text-gray-400 whitespace-nowrap">
                        {new Date(signup.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Next Steps */}
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-bold text-gray-200">Next Steps</h3>
          <ol className="space-y-2 text-sm text-gray-400 list-decimal list-inside">
            <li>
              <span className="font-medium text-gray-300">Copy the signup link</span> above and send it to prospects via text
            </li>
            <li>
              <span className="font-medium text-gray-300">Check this page regularly</span> for new signup requests
            </li>
            <li>
              <span className="font-medium text-gray-300">Return to the dashboard</span> and use "Create Customer Login" to approve signups and link them to customer accounts
            </li>
            <li>
              <span className="font-medium text-gray-300">Optional:</span> Track which referral code led to each signup
            </li>
          </ol>
        </div>
      </div>
    </main>
  )
}

import { getSessionInfo } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { generateBotTokenAction, revokeBotTokenAction } from '@/app/actions/botTokens'
import GenerateBotTokenForm from '@/app/components/GenerateBotTokenForm'
import RevokeBotTokenForm from '@/app/components/RevokeBotTokenForm'

export default async function BotTokensPage() {
  const { supabase, user, isAdmin } = await getSessionInfo()
  if (!user || !isAdmin) redirect('/login')

  const { data: tokens } = await supabase
    .from('bot_tokens')
    .select('id, bot_name, label, created_at, revoked_at, last_used_at')
    .order('created_at', { ascending: false })

  const botLabel = (botName: string) => (botName === 'app_bot' ? 'App Bot' : 'Financial Bot')

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-4 sm:p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Bot Access Tokens</h1>
        <Link href="/" className="text-sm text-gray-400 hover:text-white">
          &larr; Dashboard
        </Link>
      </div>

      <p className="text-sm text-gray-500 mb-6">
        App Bot and Financial Bot each authenticate with their own bearer token against the <code className="text-gray-400">/api/bot/*</code> routes.
        A token is shown here exactly once, at the moment it&apos;s generated - copy it immediately and hand it to the bot through a private channel
        (e.g. a secret in Grok Bot&apos;s own config), never in chat, never committed to the repo. Revoking a token takes effect immediately.
      </p>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-6">
        <h2 className="text-sm font-medium mb-3">Generate a new token</h2>
        <GenerateBotTokenForm action={generateBotTokenAction} />
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <h2 className="text-sm font-medium mb-3">Existing tokens</h2>
        <div className="space-y-2">
          {(tokens || []).length === 0 && <p className="text-sm text-gray-500">No tokens generated yet.</p>}
          {(tokens || []).map(t => (
            <div key={t.id} className="flex items-center justify-between gap-3 border border-zinc-800 rounded-lg px-3 py-2">
              <div className="text-sm">
                <p className="font-medium">
                  {botLabel(t.bot_name)}
                  {t.label && <span className="text-gray-500"> - {t.label}</span>}
                  {t.revoked_at && <span className="ml-2 text-xs text-red-400">Revoked</span>}
                </p>
                <p className="text-xs text-gray-500">
                  Created {new Date(t.created_at).toLocaleDateString()}
                  {t.last_used_at && ` - last used ${new Date(t.last_used_at).toLocaleDateString()}`}
                </p>
              </div>
              {!t.revoked_at && <RevokeBotTokenForm tokenId={t.id} label={`${botLabel(t.bot_name)}${t.label ? ` (${t.label})` : ''}`} action={revokeBotTokenAction} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

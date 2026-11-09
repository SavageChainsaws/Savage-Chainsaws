'use server'

import { revalidatePath } from 'next/cache'
import { getSessionInfo } from '@/lib/supabase/server'
import { generateBotToken, type BotName } from '@/lib/bot/auth'

type GenerateState = { success: boolean; message: string; token?: string } | null
type RevokeState = { success: boolean; message: string } | null

// The plaintext token is returned to the browser exactly once, in this
// action's own response - it is never written to bot_tokens (only its hash
// is), never logged, and never appears again after this page reloads.
// Jesse must copy it immediately and deliver it to the bot out-of-band
// (see docs/HANDOFF.md for the delivery steps) - there is no "show it
// again" button by design.
export async function generateBotTokenAction(_prevState: GenerateState, formData: FormData): Promise<GenerateState> {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const botName = formData.get('bot_name') as string
  const label = ((formData.get('label') as string) || '').trim() || null
  if (botName !== 'app_bot' && botName !== 'financial_bot' && botName !== 'unit_bot') {
    return { success: false, message: 'Invalid bot name.' }
  }

  const { token, tokenHash } = generateBotToken(botName as BotName)
  const { error } = await supabase.from('bot_tokens').insert({ bot_name: botName, token_hash: tokenHash, label })
  if (error) return { success: false, message: error.message }

  revalidatePath('/bot-tokens')
  return { success: true, message: 'Token generated - copy it now, it will not be shown again.', token }
}

export async function revokeBotTokenAction(_prevState: RevokeState, formData: FormData): Promise<RevokeState> {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const id = formData.get('id') as string
  if (!id) return { success: false, message: 'Missing token id.' }

  const { error } = await supabase.from('bot_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', id)
  if (error) return { success: false, message: error.message }

  revalidatePath('/bot-tokens')
  return { success: true, message: 'Token revoked.' }
}

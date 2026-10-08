'use client'

import { useState, useEffect, type RefObject } from 'react'
import { createClient } from '@/lib/supabase/client'
import { notifyAdminPush } from '@/lib/notifyAdminPush'

const supabase = createClient()

type Reply = {
  id: string
  message: string
  created_at: string
  customer_name: string | null
  is_admin: boolean
}

// The reply/question thread shown under a unit's diagnosis - identical
// whether or not a decision is currently pending, so both the "Needs
// Approval" decision card and the plain diagnosis-notes card render the
// same thread here instead of each keeping their own copy.
//
// Caller must render this with key={unitId} - switching units needs a
// fresh mount (its own thread, not carrying over the previous unit's).
export default function UnitMessageThread({
  unitId,
  customerId,
  customerName,
  onMessage,
  inputRef,
  highlighted,
}: {
  unitId: string
  customerId: string
  customerName: string
  onMessage: (message: string) => void
  inputRef: RefObject<HTMLInputElement | null>
  highlighted: boolean
}) {
  const [replies, setReplies] = useState<Reply[]>([])
  const [replyText, setReplyText] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase
      .from('messages')
      .select('id, message, created_at, customer_name, is_admin')
      .eq('unit_id', unitId)
      .order('created_at', { ascending: true })
      .then(({ data }) => setReplies(data || []))
  }, [unitId])

  async function submitReply() {
    if (!replyText.trim()) return
    setBusy(true)
    const { data, error } = await supabase
      .from('messages')
      .insert({
        unit_id: unitId,
        customer_id: customerId,
        customer_name: customerName,
        message: replyText.trim(),
      })
      .select('id, message, created_at, customer_name, is_admin')
      .single()
    setBusy(false)
    if (error) {
      onMessage('Could not send your reply. Try again.')
      return
    }
    setReplies(prev => [...prev, data])
    setReplyText('')
    notifyAdminPush('message', unitId)
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 uppercase tracking-wider">
        {replies.length > 0 ? 'Messages' : 'Have a question about this?'}
      </p>
      {replies.map(r => (
        <div
          key={r.id}
          className={`border rounded-lg px-3 py-2 ${
            r.is_admin ? 'bg-orange-500/10 border-orange-500/30' : 'bg-zinc-800/60 border-zinc-700'
          }`}
        >
          <p className="text-xs text-gray-500">
            {r.is_admin ? 'Savage Chainsaws' : 'You'} -{' '}
            {new Date(r.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </p>
          <p className="text-sm text-gray-200 whitespace-pre-wrap mt-0.5">{r.message}</p>
        </div>
      ))}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          ref={inputRef}
          value={replyText}
          onChange={e => setReplyText(e.target.value)}
          placeholder="Ask a question about the diagnosis or quote..."
          className={`flex-1 bg-zinc-800 border rounded-lg px-3 py-2 text-sm ${
            highlighted ? 'border-orange-500 ring-1 ring-orange-500/50' : 'border-zinc-700'
          }`}
        />
        <button
          onClick={submitReply}
          disabled={busy || !replyText.trim()}
          className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg shrink-0"
        >
          {busy ? 'Sending...' : 'Send Reply'}
        </button>
      </div>
    </div>
  )
}

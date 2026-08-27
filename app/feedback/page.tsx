'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const supabase = createClient()

type Feedback = {
  id: string
  customer_id: string | null
  customer_name: string | null
  email: string | null
  type: string
  message: string
  page: string | null
  seen: boolean | null
  created_at: string
}

export default function FeedbackPage() {
  const router = useRouter()
  const [items, setItems] = useState<Feedback[]>([])
  const [loading, setLoading] = useState(true)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [isCustomer, setIsCustomer] = useState(false)
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [customerName, setCustomerName] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [type, setType] = useState('feedback')
  const [message, setMessage] = useState('')
  const [pageRef, setPageRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }
    setUserEmail(user.email ?? null)

    const { data: cust } = await supabase
      .from('customers')
      .select('id, name, email')
      .ilike('email', user.email ?? '')
      .maybeSingle()

    if (cust) {
      setIsCustomer(true)
      setCustomerId(cust.id)
      setCustomerName(cust.name)
    }

    const { data } = await supabase
      .from('feedback')
      .select('*')
      .order('created_at', { ascending: false })

    // Customers only see their own; admin sees all
    if (cust) {
      setItems((data || []).filter(f => f.customer_id === cust.id))
    } else {
      setItems(data || [])
    }
    setLoading(false)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!message.trim()) return
    setBusy(true)
    setStatus(null)
    const { error } = await supabase.from('feedback').insert({
      customer_id: customerId,
      customer_name: customerName || userEmail,
      email: userEmail,
      type,
      message: message.trim(),
      page: pageRef.trim() || null,
      seen: false,
    })
    setBusy(false)
    if (error) {
      setStatus('Could not send. Try again.')
      return
    }
    setMessage('')
    setPageRef('')
    setShowForm(false)
    setStatus('Sent. Jesse will see it.')
    await load()
  }

  async function markSeen(id: string) {
    await supabase.from('feedback').update({ seen: true }).eq('id', id)
    await load()
  }

  async function markAllSeen() {
    const unread = items.filter(i => !i.seen)
    for (const i of unread) {
      await supabase.from('feedback').update({ seen: true }).eq('id', i.id)
    }
    await load()
  }

  const unread = items.filter(i => !i.seen)

  return (
    <main className="min-h-screen bg-zinc-950 text-white p-4 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/images/logo.png" alt="" className="h-10 w-10 object-contain" />
            <div>
              <h1 className="text-xl font-bold">
                {isCustomer ? 'Send a Message' : 'Customer Messages'}
              </h1>
              <p className="text-xs text-gray-500">
                Feedback & issue reports
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {(isCustomer || userEmail) && (
              <button
                onClick={() => setShowForm(!showForm)}
                className="bg-orange-600 hover:bg-orange-500 text-sm font-medium px-4 py-2 rounded-lg"
              >
                {showForm ? 'Close' : 'New Message'}
              </button>
            )}
            <Link
              href={isCustomer ? '/customer' : '/'}
              className="border border-zinc-700 text-sm px-3 py-2 rounded-lg hover:bg-zinc-800"
            >
              {isCustomer ? 'Portal' : 'Admin'}
            </Link>
          </div>
        </div>

        {status && (
          <div className="bg-zinc-900 border border-orange-500/40 rounded-xl px-4 py-3 text-sm text-orange-300">
            {status}
          </div>
        )}

        {showForm && (
          <form
            onSubmit={submit}
            className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-6 space-y-4"
          >
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type</label>
              <select
                value={type}
                onChange={e => setType(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
              >
                <option value="feedback">Feedback</option>
                <option value="issue">Issue / Bug</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">About which page? (optional)</label>
              <input
                value={pageRef}
                onChange={e => setPageRef(e.target.value)}
                placeholder="e.g. login, check-in, approvals"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Message *</label>
              <textarea
                required
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={4}
                placeholder="What's working, what's broken, ideas..."
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-lg"
            >
              {busy ? 'Sending...' : 'Send'}
            </button>
          </form>
        )}

        {!isCustomer && unread.length > 0 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-yellow-400">{unread.length} unread</p>
            <button
              onClick={markAllSeen}
              className="text-xs border border-zinc-600 px-3 py-1.5 rounded-lg hover:border-orange-500"
            >
              Mark all seen
            </button>
          </div>
        )}

        {loading ? (
          <p className="text-gray-500 text-sm">Loading...</p>
        ) : items.length === 0 ? (
          <p className="text-gray-500 text-sm">
            {isCustomer
              ? 'No messages yet. Use New Message to send feedback or report an issue.'
              : 'No customer messages yet.'}
          </p>
        ) : (
          <div className="space-y-3">
            {items.map(item => (
              <div
                key={item.id}
                className={`bg-zinc-900 border rounded-xl p-4 ${
                  !item.seen && !isCustomer
                    ? 'border-yellow-500/40'
                    : 'border-zinc-800'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      item.type === 'issue'
                        ? 'bg-red-500/20 text-red-400'
                        : 'bg-blue-500/20 text-blue-400'
                    }`}
                  >
                    {item.type === 'issue' ? 'Issue' : 'Feedback'}
                  </span>
                  {!item.seen && !isCustomer && (
                    <span className="text-xs text-yellow-400">New</span>
                  )}
                  <span className="text-xs text-gray-500">
                    {new Date(item.created_at).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <p className="text-sm font-medium text-gray-300">
                  {item.customer_name || item.email || 'Unknown'}
                </p>
                {item.page && (
                  <p className="text-xs text-gray-500 mt-0.5">Page: {item.page}</p>
                )}
                <p className="text-sm mt-2 whitespace-pre-wrap">{item.message}</p>
                {!isCustomer && !item.seen && (
                  <button
                    onClick={() => markSeen(item.id)}
                    className="mt-3 text-xs border border-zinc-600 px-3 py-1 rounded-lg hover:border-orange-500"
                  >
                    Mark seen
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
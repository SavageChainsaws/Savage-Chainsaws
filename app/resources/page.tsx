'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Resource = {
  id: string
  title: string
  category: string
  url: string
  description: string | null
  sort_order: number
  active: boolean
}

export default function ResourcesPage() {
  const [resources, setResources] = useState<Resource[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('maintenance')
  const [url, setUrl] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (user?.email) setIsAdmin(true)

    const { data } = await supabase
      .from('resources')
      .select('*')
      .eq('active', true)
      .order('sort_order')
      .order('title')
    setResources(data || [])
    setLoading(false)
  }

  async function addResource(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !url.trim()) return
    setBusy(true)
    setMessage(null)
    const { error } = await supabase.from('resources').insert({
      title: title.trim(),
      category,
      url: url.trim(),
      description: description.trim() || null,
    })
    setBusy(false)
    if (error) {
      setMessage('Could not add resource.')
      return
    }
    setTitle('')
    setUrl('')
    setDescription('')
    setShowAdd(false)
    setMessage('Video / resource added.')
    await load()
  }

  const safety = resources.filter(r => r.category === 'safety')
  const maintenance = resources.filter(r => r.category === 'maintenance')
  const other = resources.filter(r => r.category !== 'safety' && r.category !== 'maintenance')

  function List({ items, heading }: { items: Resource[]; heading: string }) {
    if (items.length === 0) return null
    return (
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-orange-400">{heading}</h2>
        <div className="space-y-2">
          {items.map(r => (
            <a
              key={r.id}
              href={r.url}
              target="_blank"
              rel="noreferrer"
              className="block bg-zinc-900 border border-zinc-800 hover:border-orange-500/50 rounded-xl p-4 transition"
            >
              <p className="font-medium">{r.title}</p>
              {r.description && (
                <p className="text-sm text-gray-400 mt-1">{r.description}</p>
              )}
              <p className="text-xs text-orange-400 mt-2">Open video →</p>
            </a>
          ))}
        </div>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-white p-4 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/images/logo.png" alt="" className="h-10 w-10 object-contain" />
            <div>
              <h1 className="text-xl font-bold">
                Safety & <span className="text-orange-500">Maintenance</span>
              </h1>
              <p className="text-xs text-gray-500">Videos & guides</p>
            </div>
          </div>
          <div className="flex gap-2">
            {isAdmin && (
              <button
                onClick={() => setShowAdd(!showAdd)}
                className="border border-zinc-600 text-sm px-3 py-1.5 rounded-lg hover:border-orange-500"
              >
                {showAdd ? 'Close' : 'Add'}
              </button>
            )}
            <Link
              href="/customer"
              className="border border-zinc-700 text-sm px-3 py-1.5 rounded-lg hover:bg-zinc-800"
            >
              Portal
            </Link>
            <Link
              href="/"
              className="border border-zinc-700 text-sm px-3 py-1.5 rounded-lg hover:bg-zinc-800"
            >
              Admin
            </Link>
          </div>
        </div>

        {message && (
          <div className="bg-zinc-900 border border-orange-500/40 rounded-xl px-4 py-3 text-sm text-orange-300">
            {message}
          </div>
        )}

        {showAdd && (
          <form
            onSubmit={addResource}
            className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3"
          >
            <h2 className="font-semibold text-orange-400">Add video / resource</h2>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Title *"
              required
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
            />
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
            >
              <option value="safety">Safety</option>
              <option value="maintenance">Maintenance</option>
              <option value="other">Other</option>
            </select>
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="YouTube or video URL *"
              required
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
            />
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Short description (optional)"
              rows={2}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={busy}
              className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
            >
              {busy ? 'Saving...' : 'Save Resource'}
            </button>
          </form>
        )}

        {loading ? (
          <p className="text-gray-500 text-sm">Loading...</p>
        ) : resources.length === 0 ? (
          <p className="text-gray-500 text-sm">
            No videos yet. Use Add to put in chain sharpening, tensioning, safety clips, etc.
          </p>
        ) : (
          <>
            <List items={safety} heading="Safety" />
            <List items={maintenance} heading="Maintenance" />
            <List items={other} heading="Other" />
          </>
        )}
      </div>
    </main>
  )
}
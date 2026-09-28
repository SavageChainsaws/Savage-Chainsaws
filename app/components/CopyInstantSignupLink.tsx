'use client'

import { useEffect, useState } from 'react'

// Same one-click copy pattern as CopyReferralLink, pointing at /join
// instead of /signup - the instant, no-review signup path gated by the
// secret token in shop_settings.instant_signup_token.
export default function CopyInstantSignupLink({ token }: { token: string }) {
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLink(`${window.location.origin}/join?key=${encodeURIComponent(token)}`)
  }, [token])

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  if (!link) return null

  return (
    <div className="flex items-center gap-2 min-w-0">
      <code className="text-xs text-gray-400 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 truncate">
        {link}
      </code>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 text-xs bg-orange-600 hover:bg-orange-500 text-white font-medium px-2.5 py-1 rounded-lg transition"
      >
        {copied ? 'Copied!' : 'Copy Link'}
      </button>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'

// Same one-click copy pattern as CopyReferralLink, pointing at /join
// instead of /signup - the instant, no-review signup path gated by the
// secret token in shop_settings.instant_signup_token.
//
// Two variants for two different spots: "compact" (the admin settings
// panel, where seeing/verifying the actual URL matters) shows the link
// text next to a small copy button; "button" (the sticky top-of-dashboard
// bar) is a single big obvious button with no visible URL - built for
// "someone's standing in front of me, tap once, go straight to Messages."
export default function CopyInstantSignupLink({
  token,
  variant = 'compact',
}: {
  token: string
  variant?: 'compact' | 'button'
}) {
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

  if (variant === 'button') {
    return (
      <button
        type="button"
        onClick={copy}
        className={`w-full sm:w-auto flex items-center justify-center gap-2 font-bold text-sm px-5 py-3 rounded-lg transition active:scale-[0.98] ${
          copied ? 'bg-green-600 text-white' : 'bg-orange-600 hover:bg-orange-500 text-white'
        }`}
      >
        {copied ? 'Copied! Now go text it →' : '📤 Copy Customer Signup Link'}
      </button>
    )
  }

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

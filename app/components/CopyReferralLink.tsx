'use client'

import { useEffect, useState } from 'react'

// Builds the actual signup link for a referral code client-side (origin
// isn't known at server-render time) and copies it with one click, so a
// referral partner or admin never has to hand-assemble
// /signup?ref=<CODE> themselves.
export default function CopyReferralLink({ code, className }: { code: string; className?: string }) {
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    // window.location isn't available at SSR/build time, so the full link
    // can only be computed client-side, after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLink(`${window.location.origin}/signup?ref=${encodeURIComponent(code)}`)
  }, [code])

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API can fail (permissions, non-secure context) - the link
      // text is still visible/selectable, so this is a soft failure.
      setCopied(false)
    }
  }

  if (!link) return null

  return (
    <div className={`flex items-center gap-2 min-w-0 ${className || ''}`}>
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

'use client'

import Link from 'next/link'

export default function AppNav() {
  return (
    <div className="flex flex-wrap gap-2">
      <Link
        href="/reports"
        className="border border-zinc-600 hover:border-orange-500 text-xs px-3 py-1.5 rounded-lg"
      >
        Reports
      </Link>
      <Link
        href="/inventory"
        className="border border-zinc-600 hover:border-orange-500 text-xs px-3 py-1.5 rounded-lg"
      >
        Inventory
      </Link>
      <Link
        href="/resources"
        className="border border-zinc-600 hover:border-orange-500 text-xs px-3 py-1.5 rounded-lg"
      >
        Videos
      </Link>
      <Link
        href="/feedback"
        className="border border-zinc-600 hover:border-orange-500 text-xs px-3 py-1.5 rounded-lg"
      >
        Messages
      </Link>
    </div>
  )
}
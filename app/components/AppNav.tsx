'use client'

import Link from 'next/link'

type AppNavProps = {
  mode: 'admin' | 'customer'
}

export default function AppNav({ mode }: AppNavProps) {
  if (mode === 'admin') {
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

  return (
    <div className="flex flex-wrap gap-2">
      <Link
        href="/resources"
        className="border border-zinc-600 hover:border-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
      >
        Videos
      </Link>
      <Link
        href="/feedback"
        className="border border-zinc-600 hover:border-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
      >
        Message Jesse
      </Link>
    </div>
  )
}
'use client'

import { useEffect } from 'react'

// Landing on /?customer=X&open=unitId (e.g. from the admin action/
// needs-attention screen) already expands that unit's <details> panel
// server-side, but the browser still renders at the top of the page -
// this scrolls the expanded panel into view so it doesn't require
// hunting for it further down the customer's unit list.
export default function ScrollToOpenUnit({ unitId }: { unitId: string | null }) {
  useEffect(() => {
    if (!unitId) return
    const el = document.getElementById(`unit-${unitId}`)
    if (!el) return
    // 'center' (not 'start') so the card's header clears the top bar instead
    // of landing flush against it.
    const scroll = (behavior: ScrollBehavior) => el.scrollIntoView({ behavior, block: 'center' })
    scroll('smooth')
    // Mobile browser chrome (address bar collapsing) and late image loads
    // can shift the layout right after this first scroll lands, leaving the
    // unit's header scrolled past instead of at the top - re-align once
    // things settle.
    const t1 = setTimeout(() => scroll('auto'), 350)
    const t2 = setTimeout(() => scroll('auto'), 900)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [unitId])

  return null
}

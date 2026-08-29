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
    document.getElementById(`unit-${unitId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [unitId])

  return null
}

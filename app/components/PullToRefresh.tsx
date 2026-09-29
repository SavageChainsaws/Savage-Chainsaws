'use client'

import { useEffect, useRef, useState } from 'react'

const PULL_THRESHOLD = 70 // px of downward drag needed to trigger a refresh
const MAX_PULL = 100 // visual cap so the indicator doesn't chase your finger forever

// iOS's native pull-to-refresh gesture belongs to Safari's own browser
// chrome - this app runs installed to the home screen instead (see
// app/manifest.ts's display: 'standalone'), which drops that chrome
// entirely, so there's no built-in way left to reload the page. This
// recreates just enough of the gesture: drag down from the very top of the
// page, past a threshold, and release to reload. A full page reload rather
// than a soft client-side refresh, so it also always picks up whatever's
// actually deployed instead of a stale cached bundle.
export default function PullToRefresh() {
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef<number | null>(null)
  const pulling = useRef(false)
  const distanceRef = useRef(0)

  useEffect(() => {
    function onTouchStart(e: TouchEvent) {
      if (window.scrollY > 0) return
      startY.current = e.touches[0].clientY
      pulling.current = true
    }

    function onTouchMove(e: TouchEvent) {
      if (!pulling.current || startY.current === null) return
      // Bail out the moment the page has actually scrolled (e.g. a normal
      // swipe once content is moving) rather than fighting it - this only
      // ever takes over a drag that starts and stays at the very top.
      if (window.scrollY > 0) {
        pulling.current = false
        distanceRef.current = 0
        setPullDistance(0)
        return
      }
      const delta = e.touches[0].clientY - startY.current
      if (delta <= 0) {
        distanceRef.current = 0
        setPullDistance(0)
        return
      }
      e.preventDefault()
      // Half-speed drag (matches the native iOS feel - the indicator lags
      // behind your finger rather than tracking it 1:1) and capped so it
      // never grows unbounded on a long drag.
      const next = Math.min(delta * 0.5, MAX_PULL)
      distanceRef.current = next
      setPullDistance(next)
    }

    function onTouchEnd() {
      if (!pulling.current) return
      pulling.current = false
      startY.current = null
      if (distanceRef.current >= PULL_THRESHOLD) {
        setRefreshing(true)
        window.location.reload()
      } else {
        distanceRef.current = 0
        setPullDistance(0)
      }
    }

    // touchmove must be non-passive so preventDefault can actually stop the
    // page's own bounce/scroll while a pull is in progress.
    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  if (pullDistance === 0 && !refreshing) return null

  const ready = refreshing || pullDistance >= PULL_THRESHOLD

  return (
    <div
      aria-hidden
      className="fixed top-0 left-0 right-0 z-[100] flex justify-center overflow-hidden pointer-events-none"
      style={{ height: refreshing ? 56 : pullDistance }}
    >
      <div className="flex items-center justify-center h-full">
        <div
          className={`w-6 h-6 rounded-full border-2 border-orange-500 border-t-transparent ${ready ? 'animate-spin' : ''}`}
          style={{
            transform: ready ? undefined : `rotate(${pullDistance * 3}deg)`,
            opacity: Math.min(pullDistance / PULL_THRESHOLD, 1),
          }}
        />
      </div>
    </div>
  )
}

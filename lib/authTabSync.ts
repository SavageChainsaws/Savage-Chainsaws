// Cross-tab notification for the login pages: when a customer completes a
// password reset (or signs in) in a second tab - typically opened by their
// email client from a reset/magic-link email - the original tab that was
// still sitting on the login page wakes up and redirects, instead of being
// left stale showing the old logged-out form.
//
// BroadcastChannel covers the common case instantly. Since this app's
// session lives in cookies (via @supabase/ssr, so server components and
// middleware can read it too) rather than localStorage, there's no
// automatic `storage` event to piggyback on the way plain supabase-js's
// default setup provides - hence the explicit channel. A tab can also be
// backgrounded when the broadcast fires, and BroadcastChannel isn't
// supported in every browser, so a visibility-change check and a slow
// periodic poll act as a fallback.
const CHANNEL_NAME = 'savage-chainsaws-auth'

export function notifyAuthChangedAcrossTabs() {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channel.postMessage({ type: 'auth-changed' })
    channel.close()
  } catch {
    // Ignore - other tabs still have the visibility/interval fallback.
  }
}

// Calls `recheck` whenever this tab should re-check its session: on a
// broadcast from another tab, when this tab regains focus, and on a slow
// interval as a last resort. `recheck` is responsible for actually
// checking the session and deciding what to do. Returns a cleanup function.
export function watchForAuthChangeAcrossTabs(recheck: () => void): () => void {
  const cleanups: Array<() => void> = []

  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = (event) => {
      if (event.data?.type === 'auth-changed') recheck()
    }
    cleanups.push(() => channel.close())
  }

  function handleVisibility() {
    if (document.visibilityState === 'visible') recheck()
  }
  document.addEventListener('visibilitychange', handleVisibility)
  cleanups.push(() => document.removeEventListener('visibilitychange', handleVisibility))

  const intervalId = setInterval(recheck, 15000)
  cleanups.push(() => clearInterval(intervalId))

  return () => cleanups.forEach(fn => fn())
}

// Web Push service worker. Kept as a plain static file (not built by
// Next.js) since it needs to run outside any page and survive across
// deploys with a stable URL - registered from app/components/PushToggle.tsx.

self.addEventListener('push', event => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'Savage Chainsaws'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag,
      data: { url: data.url || '/' },
    })
  )
})

// Focuses an already-open tab on the target page instead of always opening
// a new one, same as most native apps' notification tap behavior.
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      const existing = clientList.find(c => new URL(c.url).pathname === url)
      if (existing) return existing.focus()
      return self.clients.openWindow(url)
    })
  )
})

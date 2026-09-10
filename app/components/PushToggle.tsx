'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

type Support = 'checking' | 'unsupported' | 'ios-needs-install' | 'ios-needs-update' | 'supported'

// Enable/disable toggle for Web Push, shared between the admin header and
// the customer Settings panel. Source of truth for "is this on" is the
// browser's own subscription (not a stored DB flag) - covers permission
// getting revoked outside the app, and never shows a toggle the underlying
// platform can't actually back (iOS Safari needs 16.4+ and Home Screen
// installation for the Push API to exist at all).
export default function PushToggle({ label, className }: { label?: string; className?: string }) {
  const [support, setSupport] = useState<Support>('checking')
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function check() {
      const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
      const isStandalone =
        typeof window !== 'undefined' &&
        (window.matchMedia('(display-mode: standalone)').matches ||
          (navigator as Navigator & { standalone?: boolean }).standalone === true)
      const hasPushApi =
        typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

      if (!hasPushApi) {
        // iOS only exposes the Push API once the site is running from the
        // Home Screen (and only on 16.4+) - a plain Safari tab never has
        // it, regardless of iOS version, so that's the common case to
        // guide someone out of rather than just saying "unsupported".
        if (isIos && !isStandalone) {
          setSupport('ios-needs-install')
        } else if (isIos) {
          setSupport('ios-needs-update')
        } else {
          setSupport('unsupported')
        }
        return
      }
      setSupport('supported')
      if (Notification.permission === 'granted') {
        try {
          const reg = await navigator.serviceWorker.register('/sw.js')
          const sub = await reg.pushManager.getSubscription()
          if (!cancelled) setEnabled(!!sub)
        } catch {
          // Leaves the toggle showing "off" - turnOn() below will retry.
        }
      }
    }
    check()
    return () => {
      cancelled = true
    }
  }, [])

  async function turnOn() {
    setBusy(true)
    setError(null)
    try {
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!vapidKey) {
        setError('Push notifications are not configured yet.')
        return
      }
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setError(
          permission === 'denied'
            ? 'Notifications are blocked - allow them in your browser/device settings.'
            : 'Permission was not granted.'
        )
        return
      }
      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      })
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const keys = sub.toJSON().keys
      if (!user || !keys?.p256dh || !keys?.auth) {
        setError('Could not save your subscription.')
        return
      }
      const { error: dbError } = await supabase
        .from('push_subscriptions')
        .upsert(
          { user_id: user.id, endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth },
          { onConflict: 'endpoint' }
        )
      if (dbError) {
        setError('Could not save your subscription.')
        return
      }
      setEnabled(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not enable notifications.')
    } finally {
      setBusy(false)
    }
  }

  async function turnOff() {
    setBusy(true)
    setError(null)
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        await sub.unsubscribe()
      }
      setEnabled(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disable notifications.')
    } finally {
      setBusy(false)
    }
  }

  if (support === 'checking') return null

  if (support === 'unsupported') {
    return <p className={`text-xs text-gray-500 ${className || ''}`}>Push notifications aren&apos;t supported in this browser.</p>
  }

  if (support === 'ios-needs-install') {
    return (
      <p className={`text-xs text-gray-500 ${className || ''}`}>
        To get push notifications on iPhone/iPad: tap Share, then &quot;Add to Home Screen&quot;, and open the app from there.
      </p>
    )
  }

  if (support === 'ios-needs-update') {
    return <p className={`text-xs text-gray-500 ${className || ''}`}>Push notifications need iOS 16.4 or later.</p>
  }

  return (
    <div className={`flex items-center gap-2 ${className || ''}`}>
      {label && <span className="text-sm text-gray-300">{label}</span>}
      <button
        type="button"
        onClick={() => (enabled ? turnOff() : turnOn())}
        disabled={busy}
        role="switch"
        aria-checked={enabled}
        aria-label="Push notifications"
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
          enabled ? 'bg-orange-600' : 'bg-zinc-700'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
            enabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}

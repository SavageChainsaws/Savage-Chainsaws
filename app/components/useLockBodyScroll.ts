'use client'

import { useEffect } from 'react'

// Every fixed-overlay modal in this app (`fixed inset-0 ... overflow-y-auto`)
// left the background page scrollable behind it - nothing ever locked body
// scroll. On a page tall enough to have its own scrollbar, dragging the
// browser's actual scrollbar (the only one visible, since it sits flush
// against the same viewport edge as the modal's own overflow-y-auto) scrolls
// the hidden page underneath instead of the modal - which is position:fixed
// and doesn't move with it, making the modal look stuck in place. Locking
// body scroll while a modal is open removes that competing scrollbar
// entirely, so there's only ever one thing to scroll.
export default function useLockBodyScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [locked])
}

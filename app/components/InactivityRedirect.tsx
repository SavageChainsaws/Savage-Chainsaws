'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function InactivityRedirect() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const customerId = searchParams.get('customer')

  useEffect(() => {
    // If we are viewing any customer, clear the "last viewed" memory
    if (customerId) {
      localStorage.removeItem('lastViewedCustomer')
    }
  }, [customerId])

  useEffect(() => {
    // Only run the inactivity timer when viewing a specific customer
    if (!customerId) return

    let timeout: NodeJS.Timeout

    const resetTimer = () => {
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        // Save the last viewed customer before leaving
        localStorage.setItem('lastViewedCustomer', customerId)
        // Go to Action Center
        router.push('/')
      }, 5 * 60 * 1000) // 5 minutes
    }

    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart']

    events.forEach(event => {
      window.addEventListener(event, resetTimer)
    })

    resetTimer()

    return () => {
      clearTimeout(timeout)
      events.forEach(event => {
        window.removeEventListener(event, resetTimer)
      })
    }
  }, [customerId, router])

  return null
}
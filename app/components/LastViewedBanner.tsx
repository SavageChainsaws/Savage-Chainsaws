'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

export default function LastViewedBanner({ customers }: { customers: any[] }) {
  const [lastCustomerId, setLastCustomerId] = useState<string | null>(null)
  const searchParams = useSearchParams()
  const currentCustomer = searchParams.get('customer')

  useEffect(() => {
    // If we are currently viewing any customer, clear the last viewed memory
    if (currentCustomer) {
      localStorage.removeItem('lastViewedCustomer')
      setLastCustomerId(null)
      return
    }

    // Only show the banner when we are on the Action Center
    const saved = localStorage.getItem('lastViewedCustomer')
    if (saved) {
      setLastCustomerId(saved)
    }
  }, [currentCustomer])

  if (!lastCustomerId) return null

  const customer = customers.find(c => c.id === lastCustomerId)
  if (!customer) return null

  function handleReturn() {
    // Clear it as soon as they click Return
    localStorage.removeItem('lastViewedCustomer')
  }

  return (
    <div className="bg-zinc-800 border border-orange-500/40 rounded-xl p-4 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wider">Last Viewed</p>
        <p className="text-lg font-semibold text-orange-400">{customer.name}</p>
      </div>
      <Link
        href={`/?customer=${customer.id}`}
        onClick={handleReturn}
        className="bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition text-center"
      >
        Return to {customer.name} →
      </Link>
    </div>
  )
}
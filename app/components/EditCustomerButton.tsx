'use client'

import { useActionState, useEffect, useState } from 'react'
import TitleCaseInput from './TitleCaseInput'

type State = { success: boolean; message: string } | null

type Customer = {
  id: string
  name: string
  email: string | null
  secondary_email: string | null
  phone: string | null
}

// Full contact-details edit for the currently-selected customer (see
// currentCustomer in app/page.tsx) - the closest thing this dashboard has
// to a customer profile, since there's no separate customer list page.
// Mirrors the "Create Customer Login" form's fields/style rather than
// inventing a new pattern.
export default function EditCustomerButton({
  customer,
  action,
}: {
  customer: Customer
  action: (prevState: State, formData: FormData) => Promise<State>
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [state, formAction, isPending] = useActionState(action, null)

  // Closes itself once the save actually succeeds, so the admin lands back
  // on the (now-revalidated) profile showing the new values, rather than
  // having to notice a success message and close the modal by hand.
  useEffect(() => {
    if (state?.success) setIsOpen(false)
  }, [state])

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="text-xs border border-zinc-700 hover:border-orange-500 hover:bg-zinc-800 text-gray-300 px-3 py-1.5 rounded-lg transition whitespace-nowrap"
      >
        Edit Customer
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/70 p-4 overflow-y-auto"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-md w-full shadow-2xl my-8"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-semibold text-orange-400">Edit Customer</h3>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Close"
                className="text-gray-500 hover:text-white text-xl leading-none px-1"
              >
                ×
              </button>
            </div>

            <form action={formAction} className="space-y-3">
              <input type="hidden" name="id" value={customer.id} />

              <div>
                <label className="block text-xs text-gray-500 mb-1">Name</label>
                <TitleCaseInput
                  name="name"
                  defaultValue={customer.name}
                  required
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Email (Portal Login)</label>
                <input
                  name="email"
                  type="email"
                  defaultValue={customer.email || ''}
                  placeholder="customer@example.com"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                />
                <p className="text-xs text-gray-600 mt-1">
                  Updates what's shown here only - not their actual login credentials. If they already have a portal
                  login, re-run "Create Customer Login" afterward to keep it in sync.
                </p>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Secondary Email</label>
                <input
                  name="secondary_email"
                  type="email"
                  defaultValue={customer.secondary_email || ''}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Phone</label>
                <input
                  name="phone"
                  defaultValue={customer.phone || ''}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                />
              </div>

              {state && !state.success && <p className="text-sm text-red-400">{state.message}</p>}

              <button
                type="submit"
                disabled={isPending}
                className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg"
              >
                {isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { normalizeEmail } from '@/lib/text'
import PushToggle from './PushToggle'

const supabase = createClient()

type Customer = {
  id: string
  secondary_email: string | null
}

// Change Password, Secondary Email, Push Notifications, and the Messages
// link - everything behind the customer portal's "Settings" toggle.
export default function AccountSettingsCard({
  customer,
  onUpdate,
  onMessage,
}: {
  customer: Customer
  onUpdate: (updates: Partial<Customer>) => void
  onMessage: (message: string) => void
}) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [passwordBusy, setPasswordBusy] = useState(false)

  const [secondaryEmail, setSecondaryEmail] = useState(customer.secondary_email || '')
  const [secondaryEmailBusy, setSecondaryEmailBusy] = useState(false)
  const [secondaryEmailSaved, setSecondaryEmailSaved] = useState(false)

  // Same validation as /reset-password (the flow this replaces the need
  // for once a customer is already logged in - e.g. right after an
  // admin-set default password).
  async function handleChangePassword() {
    setPasswordError('')
    setPasswordSuccess(false)
    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters.')
      return
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError('Passwords do not match.')
      return
    }
    setPasswordBusy(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setPasswordBusy(false)
    if (error) {
      setPasswordError(error.message)
      return
    }
    setPasswordSuccess(true)
    setNewPassword('')
    setConfirmNewPassword('')
  }

  async function handleSaveSecondaryEmail() {
    setSecondaryEmailBusy(true)
    setSecondaryEmailSaved(false)
    const trimmed = secondaryEmail.trim() ? normalizeEmail(secondaryEmail) : ''
    const { error } = await supabase
      .from('customers')
      .update({ secondary_email: trimmed || null })
      .eq('id', customer.id)
    setSecondaryEmailBusy(false)
    if (error) {
      onMessage('Could not save secondary email.')
      return
    }
    onUpdate({ secondary_email: trimmed || null })
    setSecondaryEmailSaved(true)
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-6 space-y-5">
      <h2 className="text-lg font-semibold text-orange-400">Settings</h2>

      <div className="space-y-3">
        <p className="text-sm font-medium text-orange-300">Change Password</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="New password"
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
          <input
            type="password"
            value={confirmNewPassword}
            onChange={e => setConfirmNewPassword(e.target.value)}
            placeholder="Confirm new password"
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        {passwordError && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {passwordError}
          </p>
        )}
        {passwordSuccess && (
          <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">
            Password updated.
          </p>
        )}
        <button
          onClick={handleChangePassword}
          disabled={passwordBusy}
          className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
        >
          {passwordBusy ? 'Updating...' : 'Update Password'}
        </button>
      </div>

      <div className="border-t border-zinc-800 pt-4 space-y-3">
        <p className="text-sm font-medium text-orange-300">Secondary Email</p>
        <p className="text-xs text-gray-500">
          Add a second address (e.g. an owner or manager) to also receive reminders about your units.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            type="email"
            value={secondaryEmail}
            onChange={e => setSecondaryEmail(e.target.value)}
            placeholder="second-person@example.com"
            className="flex-1 min-w-[200px] bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={handleSaveSecondaryEmail}
            disabled={secondaryEmailBusy}
            className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            {secondaryEmailBusy ? 'Saving...' : 'Save'}
          </button>
        </div>
        {secondaryEmailSaved && (
          <p className="text-sm text-green-400">Secondary email saved.</p>
        )}
      </div>

      <div className="border-t border-zinc-800 pt-4 space-y-2">
        <p className="text-sm font-medium text-orange-300">Push Notifications</p>
        <p className="text-xs text-gray-500">
          Get notified on this device when a diagnosis is ready for approval, a unit is ready for pickup, or Savage Chainsaws replies to a message.
        </p>
        <PushToggle />
      </div>

      <div className="border-t border-zinc-800 pt-4">
        <Link
          href="/feedback"
          className="inline-block border border-zinc-600 hover:border-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
        >
          Messages
        </Link>
      </div>
    </div>
  )
}

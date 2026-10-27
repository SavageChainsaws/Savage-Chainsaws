'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import SignaturePad from './SignaturePad'
import { saveOwnerSignature } from '../actions/shopSettings'

const supabase = createClient()

// Lets Jesse draw his own signature once instead of re-signing every
// multi-unit rental agreement by hand (see RentalAgreementSignScreen,
// which auto-stamps whatever's saved here onto the Owner line). Uploads
// straight to the 'rentals' bucket client-side under a fixed filename
// (upsert: true) - same pattern as RentalPhotoUpload - so saving a new one
// just overwrites the old file at the same public URL rather than
// accumulating stale copies.
export default function OwnerSignatureSetting({ currentUrl }: { currentUrl: string | null }) {
  const [editing, setEditing] = useState(false)
  const [pendingDataUrl, setPendingDataUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function handleSave() {
    if (!pendingDataUrl) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(pendingDataUrl)
      const blob = await res.blob()
      const { error: uploadError } = await supabase.storage
        .from('rentals')
        .upload('owner-signature.png', blob, { contentType: 'image/png', upsert: true })
      if (uploadError) {
        setMessage(`Could not save: ${uploadError.message}`)
        return
      }
      const { data: { publicUrl } } = supabase.storage.from('rentals').getPublicUrl('owner-signature.png')
      // Cache-bust so the <img> preview and every future agreement PDF
      // pick up the new drawing immediately instead of a stale cached copy
      // at the same fixed filename.
      const bustedUrl = `${publicUrl}?v=${Date.now()}`
      const result = await saveOwnerSignature(bustedUrl)
      setMessage(result.message)
      if (result.success) setEditing(false)
    } catch {
      setMessage('Could not reach the server. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      <label className="block text-xs text-gray-500">
        Your Signature <span className="text-gray-600">- auto-stamped as Owner on every rental agreement a customer signs</span>
      </label>
      {!editing ? (
        <div className="flex items-center gap-3">
          {currentUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={currentUrl} alt="Saved signature" className="h-12 bg-white rounded border border-zinc-700 px-2" />
          ) : (
            <p className="text-xs text-gray-600">Not set yet - the Owner line will print blank until you add one.</p>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-orange-400 px-3 py-1.5 rounded-lg"
          >
            {currentUrl ? 'Change' : 'Draw Signature'}
          </button>
        </div>
      ) : (
        <div className="max-w-sm space-y-2">
          <SignaturePad onChange={setPendingDataUrl} height={120} />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={!pendingDataUrl || saving}
              className="text-xs bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg"
            >
              {saving ? 'Saving...' : 'Save Signature'}
            </button>
            <button
              type="button"
              onClick={() => { setEditing(false); setMessage(null) }}
              className="text-xs text-gray-400 hover:text-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {message && <p className="text-xs text-gray-400">{message}</p>}
    </div>
  )
}

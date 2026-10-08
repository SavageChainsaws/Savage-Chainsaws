'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

type Customer = {
  id: string
  logo_url: string | null
  brand_color: string | null
}

// Lets a customer pair a brand color with their logo - shown together here
// since the two travel together everywhere they're used (e.g. the admin
// Repair Flow page boxes off each customer's units using this color,
// falling back to the Savage Chainsaws orange when unset).
export default function LogoSettingsCard({
  customer,
  onUpdate,
  onMessage,
  onSaved,
}: {
  customer: Customer
  onUpdate: (updates: Partial<Customer>) => void
  onMessage: (message: string | null) => void
  onSaved: () => void
}) {
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [logoBusy, setLogoBusy] = useState(false)

  const [brandColor, setBrandColor] = useState(customer.brand_color || '#ea580c')
  const [brandColorBusy, setBrandColorBusy] = useState(false)

  async function uploadFile(file: File, prefix: string) {
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const fileName = `${prefix}-${Date.now()}-${safe}`
    const { error } = await supabase.storage
      .from('invoices')
      .upload(fileName, file, {
        contentType: file.type || 'image/jpeg',
        upsert: false,
      })
    if (error) throw error
    const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(fileName)
    return publicUrl
  }

  function onLogoPick(file: File | null) {
    setLogoFile(file)
    if (logoPreview) URL.revokeObjectURL(logoPreview)
    setLogoPreview(file ? URL.createObjectURL(file) : null)
  }

  async function saveLogo() {
    if (!logoFile) return
    setLogoBusy(true)
    onMessage(null)
    try {
      const url = await uploadFile(logoFile, `logo-${customer.id}`)
      const { error } = await supabase
        .from('customers')
        .update({ logo_url: url })
        .eq('id', customer.id)
      if (error) throw error
      onUpdate({ logo_url: url })
      onLogoPick(null)
      onSaved()
      onMessage('Company logo updated.')
    } catch (err) {
      console.error(err)
      onMessage('Could not upload logo. Try a smaller image (JPG/PNG).')
    }
    setLogoBusy(false)
  }

  async function removeLogo() {
    if (!confirm('Remove your company logo?')) return
    setLogoBusy(true)
    const { error } = await supabase
      .from('customers')
      .update({ logo_url: null })
      .eq('id', customer.id)
    setLogoBusy(false)
    if (error) {
      onMessage('Could not remove logo.')
      return
    }
    onUpdate({ logo_url: null })
    onMessage('Company logo removed.')
  }

  async function saveBrandColor() {
    setBrandColorBusy(true)
    const { error } = await supabase
      .from('customers')
      .update({ brand_color: brandColor })
      .eq('id', customer.id)
    setBrandColorBusy(false)
    if (error) {
      onMessage('Could not save brand color.')
      return
    }
    onUpdate({ brand_color: brandColor })
    onMessage('Brand color saved.')
  }

  async function resetBrandColor() {
    setBrandColorBusy(true)
    const { error } = await supabase
      .from('customers')
      .update({ brand_color: null })
      .eq('id', customer.id)
    setBrandColorBusy(false)
    if (error) {
      onMessage('Could not reset brand color.')
      return
    }
    onUpdate({ brand_color: null })
    setBrandColor('#ea580c')
    onMessage('Brand color reset to default.')
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5 space-y-3">
      <h2 className="text-lg font-semibold text-orange-400">Company Logo</h2>
      <p className="text-sm text-gray-500">
        Upload your logo. It appears at the top of your portal.
      </p>
      <div className="flex items-center gap-4">
        <img
          src={logoPreview || customer.logo_url || '/images/logo.png'}
          alt="Logo preview"
          className="h-16 w-16 object-contain rounded-lg border border-zinc-700 bg-zinc-950"
        />
        <div className="space-y-2">
          <label className="inline-flex items-center justify-center bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg cursor-pointer">
            Choose Logo
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => onLogoPick(e.target.files?.[0] || null)}
            />
          </label>
          {logoFile && (
            <button
              onClick={saveLogo}
              disabled={logoBusy}
              className="block bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
            >
              {logoBusy ? 'Uploading...' : 'Save Logo'}
            </button>
          )}
          {customer.logo_url && !logoFile && (
            <button
              onClick={removeLogo}
              disabled={logoBusy}
              className="block text-sm text-red-400 hover:text-red-300 disabled:opacity-50"
            >
              Remove logo
            </button>
          )}
        </div>
      </div>

      <div className="border-t border-zinc-800 pt-3 space-y-2">
        <p className="text-sm font-medium text-white">Brand Color</p>
        <p className="text-xs text-gray-500">
          Used to box off your units on our end - defaults to Savage Chainsaws orange if you skip this.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={brandColor}
            onChange={e => setBrandColor(e.target.value)}
            className="h-9 w-14 bg-zinc-900 border border-zinc-700 rounded-lg cursor-pointer"
          />
          <button
            onClick={saveBrandColor}
            disabled={brandColorBusy}
            className="bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            {brandColorBusy ? 'Saving...' : 'Save Color'}
          </button>
          {customer.brand_color && (
            <button
              onClick={resetBrandColor}
              disabled={brandColorBusy}
              className="text-sm text-red-400 hover:text-red-300 disabled:opacity-50"
            >
              Reset to default
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

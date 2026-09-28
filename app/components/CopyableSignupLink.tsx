'use client'

import { useState } from 'react'

export default function CopyableSignupLink() {
  const [copied, setCopied] = useState(false)
  const [referralCode, setReferralCode] = useState('')
  const [showQr, setShowQr] = useState(false)

  // Get the domain from window.location
  const domain = typeof window !== 'undefined' ? window.location.origin : 'https://app.savagechainsaws.com'
  const baseUrl = `${domain}/signup`
  const signupUrl = referralCode ? `${baseUrl}?ref=${referralCode.toUpperCase()}` : baseUrl

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(signupUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  // Simple QR code generator using data URL (won't work offline, but good for quick display)
  // In production, consider using qrcode.react or a QR code API
  const generateQRDataUrl = (text: string): string => {
    // Using a simple QR code API for demo - in production use a proper library
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(text)}`
  }

  return (
    <div className="space-y-4">
      {/* Link Display */}
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4">
        <div className="mb-2">
          <label className="text-xs font-medium text-orange-300 block mb-1">Base Signup Link</label>
          <code className="text-xs text-orange-100 bg-orange-500/10 border border-orange-500/30 rounded px-3 py-2 block overflow-x-auto">
            {signupUrl}
          </code>
        </div>
        <button
          onClick={copyToClipboard}
          className={`w-full py-2.5 px-4 rounded-lg font-medium text-sm transition ${
            copied
              ? 'bg-green-600 text-white'
              : 'bg-orange-600 hover:bg-orange-500 text-white'
          }`}
        >
          {copied ? '✓ Copied to Clipboard' : 'Copy Link'}
        </button>
      </div>

      {/* Referral Code Input */}
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4">
        <label className="block text-sm font-medium text-gray-300 mb-2">Generate Referral Link (Optional)</label>
        <p className="text-xs text-gray-500 mb-3">
          Create a customized link for a specific referral source or campaign
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
            placeholder="e.g. ELVIS, LANDSCAPING, HVAC"
            maxLength={20}
            className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 uppercase"
          />
          <button
            onClick={copyToClipboard}
            disabled={!referralCode}
            className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-lg transition whitespace-nowrap"
          >
            Copy
          </button>
        </div>
      </div>

      {/* QR Code Display */}
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-300">QR Code (Optional)</label>
          <button
            onClick={() => setShowQr(!showQr)}
            className="text-xs text-orange-400 hover:text-orange-300 underline"
          >
            {showQr ? 'Hide' : 'Show'}
          </button>
        </div>
        {showQr && (
          <div className="bg-white p-3 rounded-lg inline-block">
            <img
              src={generateQRDataUrl(signupUrl)}
              alt="QR Code for signup link"
              width={150}
              height={150}
              className="bg-white"
            />
          </div>
        )}
        {showQr && (
          <p className="text-xs text-gray-500 mt-2">
            Print or display this QR code on your website, business cards, or job site
          </p>
        )}
      </div>

      {/* Quick Tips */}
      <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
        <p className="text-xs font-medium text-gray-300 mb-2">💡 Quick Tips:</p>
        <ul className="space-y-1 text-xs text-gray-400">
          <li>• Text the base link to prospects for immediate account requests</li>
          <li>• Use referral codes to track which sources generate the most leads (e.g., ?ref=ELVIS)</li>
          <li>• Share the QR code on your website or job site</li>
          <li>• Each signup will appear in the "Recent Signup Requests" section below</li>
        </ul>
      </div>
    </div>
  )
}

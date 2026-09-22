'use client'

import { useActionState, useState } from 'react'

type LinkState = { success: boolean; message: string; url?: string } | null
type StatusState = { success: boolean; message: string; paid?: boolean } | null

// Square's Payment Links are generated on demand only (never automatically
// when an invoice is created) - this renders "Generate Payment Link" until
// one exists, then swaps to Pay Now + a manual "Check Payment Status"
// fallback (the webhook in app/api/webhooks/square/route.ts keeps Paid
// status in sync automatically once configured; this button covers
// whenever that isn't set up yet or a delivery is missed).
export default function InvoicePaymentActions({
  invoiceId,
  paymentLinkUrl,
  isPaid,
  generateAction,
  checkStatusAction,
}: {
  invoiceId: string
  paymentLinkUrl: string | null
  isPaid: boolean
  generateAction: (prevState: LinkState, formData: FormData) => Promise<LinkState>
  checkStatusAction: (prevState: StatusState, formData: FormData) => Promise<StatusState>
}) {
  const [genState, genAction, genPending] = useActionState(generateAction, null)
  const [checkState, checkAction, checkPending] = useActionState(checkStatusAction, null)
  const [copied, setCopied] = useState(false)

  const currentUrl = genState?.url || paymentLinkUrl
  // Pre-filled SMS body for customers with no email on file, or who'd
  // rather get a text - sms: link support (and whether ?body= vs &body=
  // is honored) varies by device/OS, and does nothing on a desktop browser
  // with no SMS handler at all; there's no way to detect that in advance,
  // so this is offered unconditionally and simply no-ops there.
  const smsHref = currentUrl
    ? `sms:?&body=${encodeURIComponent(`Pay your Savage Chainsaws invoice: ${currentUrl}`)}`
    : ''

  async function copyLink() {
    if (!currentUrl) return
    try {
      await navigator.clipboard.writeText(currentUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        {currentUrl ? (
          <>
            <input
              type="text"
              readOnly
              value={currentUrl}
              onFocus={e => e.target.select()}
              title={currentUrl}
              className="text-xs bg-zinc-800 border border-zinc-700 rounded-lg px-1.5 py-1 w-20 focus:w-48 transition-[width] text-gray-300 focus:outline-none focus:border-orange-500"
            />
            <a
              href={currentUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs bg-[#006aff] hover:bg-[#0057d1] text-white font-medium px-2 py-1 rounded-lg transition whitespace-nowrap"
            >
              Pay Now
            </a>
            <button
              type="button"
              onClick={copyLink}
              title="Copy payment link"
              className="text-xs border border-zinc-700 hover:bg-zinc-800 text-gray-300 px-2 py-1 rounded-lg transition whitespace-nowrap"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <a
              href={smsHref}
              title="Share via text message"
              className="text-xs border border-zinc-700 hover:bg-zinc-800 text-gray-300 px-2 py-1 rounded-lg transition whitespace-nowrap"
            >
              Text
            </a>
            {!isPaid && (
              <form action={checkAction}>
                <input type="hidden" name="invoice_id" value={invoiceId} />
                <button
                  type="submit"
                  disabled={checkPending}
                  title="Check Payment Status"
                  className="text-xs border border-zinc-700 hover:bg-zinc-800 disabled:opacity-50 text-gray-300 px-2 py-1 rounded-lg transition whitespace-nowrap"
                >
                  {checkPending ? 'Checking...' : 'Check Status'}
                </button>
              </form>
            )}
          </>
        ) : (
          <form action={genAction}>
            <input type="hidden" name="invoice_id" value={invoiceId} />
            <button
              type="submit"
              disabled={genPending}
              title="Generate Payment Link"
              className="text-xs bg-[#006aff] hover:bg-[#0057d1] disabled:opacity-50 text-white font-medium px-2 py-1 rounded-lg transition whitespace-nowrap"
            >
              {genPending ? 'Generating...' : 'Get Link'}
            </button>
          </form>
        )}
      </div>
      {genState && !genState.success && (
        <p className="text-xs max-w-[220px] text-right text-red-400">{genState.message}</p>
      )}
      {checkState && (
        <p className={`text-xs max-w-[220px] text-right ${checkState.paid ? 'text-green-400' : 'text-gray-400'}`}>
          {checkState.message}
        </p>
      )}
    </div>
  )
}

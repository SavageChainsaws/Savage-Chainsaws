import type { RefObject } from 'react'
import { UnitPhotoGallery } from './UnitPhotoGallery'
import UnitMessageThread from './UnitMessageThread'
import { formatShortDate } from '@/lib/dates'

type DecisionUnit = {
  id: string
  status: string
  diagnosis_notes: string | null
  diagnosis_notes_updated_at: string | null
  notes: string | null
  invoice_url: string | null
}

type DiagnosisMedia = {
  id: string
  url: string
  caption: string | null
  media_type: 'photo' | 'video'
  stage: 'checkin' | 'diagnosis'
}

// Shows a unit's diagnosis - as a loud "Repair decision needed" card with
// Approve/Deny/Ask a Question while a decision is pending, or as a plain
// read-only diagnosis card once it's been decided. Previously two
// separately-styled, stacked boxes that largely repeated the same
// diagnosis text/estimate link - now one card either way, reading as
// connected. Renders nothing once there's neither a pending decision nor
// any diagnosis notes to show.
export default function DiagnosisDecisionCard({
  unit,
  unitPhotos,
  estimateTotal,
  pdfUrl,
  customerId,
  customerName,
  onMessage,
  inputRef,
  highlighted,
  onLightboxOpen,
  onApprove,
  onDeny,
  onAskQuestion,
}: {
  unit: DecisionUnit
  unitPhotos: DiagnosisMedia[]
  estimateTotal: number | null
  pdfUrl: string | null
  customerId: string
  customerName: string
  onMessage: (message: string) => void
  inputRef: RefObject<HTMLInputElement | null>
  highlighted: boolean
  onLightboxOpen: (media: { url: string; isVideo: boolean; caption: string | null }) => void
  onApprove: () => void
  onDeny: () => void
  onAskQuestion: () => void
}) {
  const diagnosisMedia = unitPhotos.filter(p => p.stage === 'diagnosis')

  if (unit.status === 'Needs Approval') {
    const shown = diagnosisMedia.slice(0, 4)
    const remaining = diagnosisMedia.length - shown.length
    return (
      <div className="border border-yellow-500/30 rounded-xl bg-yellow-500/10 p-3 sm:p-4 space-y-3">
        <p className="text-xs text-yellow-400 uppercase tracking-wider">Repair decision needed</p>

        {unit.diagnosis_notes ? (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-sm font-bold text-orange-300">Diagnosis Notes</p>
              {unit.diagnosis_notes_updated_at && (
                <span className="text-xs text-orange-400 bg-orange-500/10 border border-orange-500/30 rounded-full px-2 py-0.5">
                  Updated {formatShortDate(unit.diagnosis_notes_updated_at)}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-200 whitespace-pre-wrap">{unit.diagnosis_notes}</p>
          </div>
        ) : (
          <p className="text-sm text-gray-200">
            {unit.notes || 'Jesse has a repair recommendation for this unit.'}
          </p>
        )}

        {unit.diagnosis_notes && unit.notes && (
          <div>
            <p className="text-sm font-bold text-blue-300 mb-1">Your Reported Issue</p>
            <p className="text-sm text-blue-100 whitespace-pre-wrap">{unit.notes}</p>
          </div>
        )}

        {diagnosisMedia.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <UnitPhotoGallery
              size="sm"
              photos={shown.map(p => ({ id: p.id, url: p.url, caption: p.caption, mediaType: p.media_type }))}
              onPhotoClick={p => onLightboxOpen({ url: p.url, isVideo: p.mediaType === 'video', caption: p.caption ?? null })}
            />
            {remaining > 0 && (
              <span className="text-xs text-gray-500">+{remaining} more</span>
            )}
          </div>
        )}

        {estimateTotal != null && (
          <p className="text-sm font-bold text-yellow-300">
            Estimate total: ${estimateTotal.toFixed(2)}
          </p>
        )}
        {/* pdfUrl (the actual generated invoice, read straight from the
            invoices table) takes priority over the older units.invoice_url,
            which needs a separate manual upload step to ever get set -
            see the caller. Styled as a real button, same weight as
            Approve/Deny below - a judgment call needs the actual
            line-itemized invoice in front of someone, not a small
            underlined link easy to scroll past. */}
        {pdfUrl && (
          <a
            href={pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            📄 View Full Invoice (PDF) {'->'}
          </a>
        )}

        <UnitMessageThread
          key={unit.id}
          unitId={unit.id}
          customerId={customerId}
          customerName={customerName}
          onMessage={onMessage}
          inputRef={inputRef}
          highlighted={highlighted}
        />

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={onApprove}
            className="bg-green-600 hover:bg-green-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
          >
            Approve
          </button>
          <button
            onClick={() => {
              if (confirm('Deny this repair? A $49.99 diagnosis fee will be charged.')) {
                onDeny()
              }
            }}
            className="bg-red-700 hover:bg-red-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
          >
            Deny ($49.99 diag)
          </button>
          <button
            onClick={onAskQuestion}
            className="bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
          >
            Ask a Question
          </button>
        </div>
      </div>
    )
  }

  if (!unit.diagnosis_notes) return null

  return (
    <div className="border border-orange-500/30 rounded-xl bg-orange-500/[0.03] p-3 sm:p-4 space-y-3">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <p className="text-sm font-bold text-orange-300">Diagnosis Notes</p>
          {unit.diagnosis_notes_updated_at && (
            <span className="text-xs text-orange-400 bg-orange-500/10 border border-orange-500/30 rounded-full px-2 py-0.5">
              Updated {formatShortDate(unit.diagnosis_notes_updated_at)}
            </span>
          )}
        </div>
        <p className="text-sm text-gray-200 whitespace-pre-wrap">{unit.diagnosis_notes}</p>
      </div>

      {unit.notes && (
        <div>
          <p className="text-sm font-bold text-blue-300 mb-1">Your Reported Issue</p>
          <p className="text-sm text-blue-100 whitespace-pre-wrap">{unit.notes}</p>
        </div>
      )}

      {pdfUrl && (
        <a
          href={pdfUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-sm text-orange-400 hover:text-orange-300 underline"
        >
          View Estimate / Quote (PDF) {'->'}
        </a>
      )}

      {diagnosisMedia.length > 0 && (
        <div className="space-y-2">
          {/* Deliberately loud - easy to overlook as plain text, so it
              gets the same highlighted-box treatment as the admin side. */}
          <div className="flex items-center gap-2 bg-orange-500/15 border border-orange-500/40 rounded-lg px-3 py-2.5">
            <span className="text-sm font-bold text-orange-300 uppercase tracking-wide">
              Diagnosis Findings - Photos &amp; Videos
            </span>
            <span className="text-xs bg-orange-500 text-black font-bold rounded-full px-2 py-0.5">{diagnosisMedia.length}</span>
          </div>
          <UnitPhotoGallery
            photos={diagnosisMedia.map(p => ({ id: p.id, url: p.url, caption: p.caption, mediaType: p.media_type }))}
          />
        </div>
      )}

      <UnitMessageThread
        key={unit.id}
        unitId={unit.id}
        customerId={customerId}
        customerName={customerName}
        onMessage={onMessage}
        inputRef={inputRef}
        highlighted={highlighted}
      />
    </div>
  )
}

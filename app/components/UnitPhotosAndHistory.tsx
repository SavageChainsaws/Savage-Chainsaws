import { UnitPhotoGallery } from './UnitPhotoGallery'
import { BeforeAfterCompare } from './BeforeAfterCompare'
import { formatShortDate } from '@/lib/dates'

type HistoryUnit = {
  photo_url: string | null
  created_at: string
}

type PhotoEntry = {
  id: string
  url: string
  caption: string | null
  media_type: 'photo' | 'video'
  stage: 'checkin' | 'diagnosis'
  created_at: string
}

type ServiceHistoryEntry = {
  id: string
  service_date: string
  description: string
}

// Read-only check-in photos, before/after compare, and service history for
// the selected unit's detail panel - no handlers of its own, since nothing
// here is editable from the customer portal.
export default function UnitPhotosAndHistory({
  unit,
  unitPhotos,
  serviceHistory,
  serviceHistoryLoading,
}: {
  unit: HistoryUnit
  unitPhotos: PhotoEntry[]
  serviceHistory: ServiceHistoryEntry[]
  serviceHistoryLoading: boolean
}) {
  const photos = [
    ...(unit.photo_url
      ? [{ id: 'checkin', url: unit.photo_url, caption: 'Check-in photo', deletable: false }]
      : []),
    ...unitPhotos.filter(p => p.stage === 'checkin'),
  ]

  const beforePhotos = [
    ...(unit.photo_url
      ? [{ id: 'checkin-primary', url: unit.photo_url, label: formatShortDate(unit.created_at) }]
      : []),
    ...unitPhotos
      .filter(p => p.stage === 'checkin')
      .map(p => ({ id: p.id, url: p.url, label: p.caption || formatShortDate(p.created_at) })),
  ]
  const afterPhotos = unitPhotos
    .filter(p => p.stage === 'diagnosis' && p.media_type !== 'video')
    .map(p => ({ id: p.id, url: p.url, label: p.caption || formatShortDate(p.created_at) }))

  return (
    <>
      <div className="border-t border-zinc-800 pt-3">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Photos</p>
        {photos.length === 0 ? (
          <p className="text-xs text-gray-500">No photos yet.</p>
        ) : (
          <UnitPhotoGallery photos={photos} />
        )}
        <BeforeAfterCompare beforePhotos={beforePhotos} afterPhotos={afterPhotos} />
      </div>

      <div className="border-t border-zinc-800 pt-3">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Service History</p>
        {serviceHistoryLoading ? (
          <p className="text-xs text-gray-500">Loading...</p>
        ) : serviceHistory.length === 0 ? (
          <p className="text-xs text-gray-500">
            No completed service logged yet for this unit.
          </p>
        ) : (
          <div className="space-y-1.5">
            {serviceHistory.map(e => (
              <div key={e.id} className="flex flex-wrap items-start gap-2 text-sm bg-zinc-950/60 border border-zinc-800 rounded-lg px-3 py-2">
                <span className="text-gray-500 w-24 shrink-0">{formatShortDate(e.service_date)}</span>
                <span className="text-gray-300 flex-1 min-w-[140px]">{e.description}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

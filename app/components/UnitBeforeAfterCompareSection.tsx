import { BeforeAfterCompare } from './BeforeAfterCompare'
import { formatShortDate } from '@/lib/dates'

type PhotoEntry = { unit_id: string; id: string; url: string; caption: string | null; stage: string; media_type: string; created_at: string }

// Pairs the earliest check-in photo with the most recent diagnosis photo
// on file so drop-off vs. pickup condition is visible at a glance -
// renders nothing (via BeforeAfterCompare's own guard) unless both a
// check-in and a diagnosis photo actually exist for this unit. Works
// retroactively on any unit's existing photos, not just future check-ins.
export default function UnitBeforeAfterCompareSection({
  unit,
  unitPhotosAll,
}: {
  unit: { id: string; photo_url: string | null; created_at: string }
  unitPhotosAll: PhotoEntry[]
}) {
  const beforePhotos = [
    ...(unit.photo_url ? [{ id: 'checkin-primary', url: unit.photo_url, label: formatShortDate(unit.created_at) }] : []),
    ...unitPhotosAll
      .filter(p => p.unit_id === unit.id && p.stage === 'checkin')
      .map(p => ({ id: p.id, url: p.url, label: p.caption || formatShortDate(p.created_at) })),
  ]
  const afterPhotos = unitPhotosAll
    .filter(p => p.unit_id === unit.id && p.stage === 'diagnosis' && p.media_type !== 'video')
    .map(p => ({ id: p.id, url: p.url, label: p.caption || formatShortDate(p.created_at) }))
  return <BeforeAfterCompare beforePhotos={beforePhotos} afterPhotos={afterPhotos} />
}

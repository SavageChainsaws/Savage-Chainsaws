import { UnitPhotoGallery } from './UnitPhotoGallery'
import UnitPhotoUpload from './UnitPhotoUpload'
import { addUnitPhoto, deleteUnitPhoto } from '../actions/unitPhotos'

type PhotoEntry = { unit_id: string; id: string; url: string; caption: string | null; stage: string }

export default function UnitPhotosSection({
  unit,
  unitPhotosAll,
}: {
  unit: { id: string; photo_url: string | null }
  unitPhotosAll: PhotoEntry[]
}) {
  const extraPhotos = unitPhotosAll.filter(p => p.unit_id === unit.id && p.stage === 'checkin')
  const photos = [
    ...(unit.photo_url ? [{ id: 'checkin', url: unit.photo_url, caption: 'Check-in photo', deletable: false }] : []),
    ...extraPhotos.map(p => ({ id: p.id, url: p.url, caption: p.caption })),
  ]
  return (
    <details className="mt-3 border-t border-zinc-800 pt-2.5 group/photos-panel">
      <summary className="flex items-center justify-between cursor-pointer list-none select-none mb-2">
        <span className="text-xs text-gray-500 uppercase tracking-wider">
          Photos{photos.length > 0 ? ` (${photos.length})` : ''}
        </span>
        <span className="text-gray-500 text-xs group-open/photos-panel:rotate-180 transition">v</span>
      </summary>
      <div className="space-y-2">
        {photos.length === 0 ? (
          <p className="text-xs text-gray-500">No photos yet.</p>
        ) : (
          <UnitPhotoGallery photos={photos} onDelete={deleteUnitPhoto} />
        )}
        <UnitPhotoUpload unitId={unit.id} action={addUnitPhoto} />
      </div>
    </details>
  )
}

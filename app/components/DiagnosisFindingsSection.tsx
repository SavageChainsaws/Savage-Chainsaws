import { UnitPhotoGallery } from './UnitPhotoGallery'
import DiagnosisMediaUpload from './DiagnosisMediaUpload'
import { deleteUnitPhoto, addDiagnosisMedia } from '../actions/unitPhotos'

type PhotoEntry = { unit_id: string; id: string; url: string; caption: string | null; stage: string; media_type: string }

// Diagnosis Findings - a section deliberately separate from Photos above:
// its own heading, own upload control (multi-select, photos and videos),
// own storage tag (stage: 'diagnosis'). Never mixes with the check-in
// gallery. Visible to the customer too (see the matching block in
// app/customer/page.tsx), right alongside Diagnosis Notes.
export default function DiagnosisFindingsSection({
  unit,
  unitPhotosAll,
}: {
  unit: { id: string }
  unitPhotosAll: PhotoEntry[]
}) {
  const media = unitPhotosAll.filter(p => p.unit_id === unit.id && p.stage === 'diagnosis')
  return (
    <details className="mt-3 group/diagnosis-media-panel" open={media.length > 0}>
      {/* Deliberately loud - this used to be an easy-to-miss plain-text
          caption. A highlighted, bordered box makes it impossible to
          scroll past without noticing there's media attached. */}
      <summary className="flex items-center justify-between gap-2 cursor-pointer list-none select-none bg-orange-500/15 border border-orange-500/40 rounded-lg px-3 py-2.5 hover:bg-orange-500/20 transition">
        <span className="flex items-center gap-2 text-sm font-bold text-orange-300 uppercase tracking-wide">
          Diagnosis Findings - Photos &amp; Videos
          {media.length > 0 && (
            <span className="text-xs bg-orange-500 text-black font-bold rounded-full px-2 py-0.5">{media.length}</span>
          )}
        </span>
        <span className="text-orange-400 text-xs group-open/diagnosis-media-panel:rotate-180 transition">v</span>
      </summary>
      <div className="space-y-2 mt-2">
        {media.length === 0 ? (
          <p className="text-xs text-gray-500">No diagnosis photos/videos yet.</p>
        ) : (
          <UnitPhotoGallery
            photos={media.map(p => ({ id: p.id, url: p.url, caption: p.caption, mediaType: p.media_type as 'photo' | 'video' }))}
            onDelete={deleteUnitPhoto}
          />
        )}
        <DiagnosisMediaUpload unitId={unit.id} action={addDiagnosisMedia} />
      </div>
    </details>
  )
}

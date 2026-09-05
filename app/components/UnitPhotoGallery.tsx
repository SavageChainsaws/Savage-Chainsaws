type Photo = { id: string; url: string; caption?: string | null; deletable?: boolean; mediaType?: 'photo' | 'video' }

// Shown on both admin and customer unit detail views. onDelete is only ever
// passed in from the admin dashboard - omitting it (customer portal) makes
// this read-only with no way to infer a delete action exists. The original
// check-in photo (deletable: false) never gets a delete button regardless -
// its lifecycle belongs to the check-in flow, not this gallery.
//
// mediaType picks image vs. video rendering - shared by the check-in
// gallery (always 'photo') and the Diagnosis Findings gallery (photo or
// video), so both stay visually consistent without duplicating this markup.
//
// onPhotoClick swaps the default "open in a new tab" <a> for a <button>
// that hands back the clicked photo instead - used by the compact
// thumbnails inline in the customer's Repair Decision Needed card, which
// open a lightbox rather than navigating away. Omitting it keeps every
// other call site's existing navigate-away behavior unchanged.
export function UnitPhotoGallery({
  photos,
  onDelete,
  size = 'md',
  onPhotoClick,
}: {
  photos: Photo[]
  onDelete?: (formData: FormData) => Promise<void>
  size?: 'sm' | 'md'
  onPhotoClick?: (photo: Photo) => void
}) {
  const imgSize = size === 'sm' ? 'h-14 w-14' : 'h-20 w-20'
  const videoSize = size === 'sm' ? 'h-14 w-20' : 'h-28 w-36'
  return (
    <div className="flex flex-wrap gap-2">
      {photos.map(p => {
        const isVideo = p.mediaType === 'video'
        const media = isVideo ? (
          <video
            src={p.url}
            title={p.caption || undefined}
            muted
            className={`${videoSize} object-cover rounded-lg bg-black ${
              p.deletable === false ? 'border-2 border-dashed border-amber-500/70' : 'border border-zinc-700'
            }`}
          />
        ) : (
          <img
            src={p.url}
            alt={p.caption || 'Unit photo'}
            title={p.caption || undefined}
            className={`${imgSize} object-cover rounded-lg ${
              p.deletable === false ? 'border-2 border-dashed border-amber-500/70' : 'border border-zinc-700'
            }`}
          />
        )
        return (
          <div key={p.id} className="relative">
            {onPhotoClick ? (
              <button type="button" onClick={() => onPhotoClick(p)} title={p.caption || undefined}>
                {media}
              </button>
            ) : (
              <a href={p.url} target="_blank" rel="noreferrer">
                {media}
              </a>
            )}
            {onDelete && p.deletable !== false && (
              <form action={onDelete} className="absolute -top-1.5 -right-1.5">
                <input type="hidden" name="id" value={p.id} />
                <button
                  type="submit"
                  title="Remove photo"
                  className="h-5 w-5 flex items-center justify-center rounded-full bg-red-600 hover:bg-red-500 text-white text-xs leading-none"
                >
                  x
                </button>
              </form>
            )}
          </div>
        )
      })}
    </div>
  )
}

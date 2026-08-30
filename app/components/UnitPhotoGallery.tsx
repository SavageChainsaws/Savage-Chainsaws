type Photo = { id: string; url: string; caption?: string | null; deletable?: boolean }

// Shown on both admin and customer unit detail views. onDelete is only ever
// passed in from the admin dashboard - omitting it (customer portal) makes
// this read-only with no way to infer a delete action exists. The original
// check-in photo (deletable: false) never gets a delete button regardless -
// its lifecycle belongs to the check-in flow, not this gallery.
export function UnitPhotoGallery({
  photos,
  onDelete,
}: {
  photos: Photo[]
  onDelete?: (formData: FormData) => Promise<void>
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {photos.map(p => (
        <div key={p.id} className="relative">
          <a href={p.url} target="_blank" rel="noreferrer">
            <img
              src={p.url}
              alt={p.caption || 'Unit photo'}
              title={p.caption || undefined}
              className={`h-20 w-20 object-cover rounded-lg ${
                p.deletable === false ? 'border-2 border-dashed border-amber-500/70' : 'border border-zinc-700'
              }`}
            />
          </a>
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
      ))}
    </div>
  )
}

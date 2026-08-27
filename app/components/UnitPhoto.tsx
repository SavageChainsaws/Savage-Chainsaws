type UnitWithPhotos = {
  thumbnail_url?: string | null
  photo_url?: string | null
}

export function getUnitPhoto(unit: UnitWithPhotos): { src: string; isReference: boolean } | null {
  if (unit.thumbnail_url) return { src: unit.thumbnail_url, isReference: false }
  if (unit.photo_url) return { src: unit.photo_url, isReference: true }
  return null
}

// Thumbnail = deliberately chosen fleet/unit photo (plain border).
// Reference = intake/check-in photo shown only because no thumbnail was set
// (dashed amber border + REF badge), so it's never mistaken for the thumbnail.
export function UnitPhoto({
  unit,
  size,
  wrapperClassName = 'shrink-0',
  emptyContent,
}: {
  unit: UnitWithPhotos
  size: string
  wrapperClassName?: string
  emptyContent?: React.ReactNode
}) {
  const img = getUnitPhoto(unit)

  if (!img) {
    return (
      <div className={`${size} rounded-lg border border-zinc-700 bg-zinc-800 ${wrapperClassName} flex items-center justify-center text-zinc-600 text-[10px] sm:text-xs`}>
        {emptyContent}
      </div>
    )
  }

  return (
    <div className={`relative ${wrapperClassName}`}>
      <img
        src={img.src}
        alt={img.isReference ? 'Work reference photo' : 'Unit thumbnail'}
        title={img.isReference ? 'Work reference photo (no thumbnail set)' : 'Unit thumbnail'}
        className={`${size} object-cover rounded-lg ${
          img.isReference ? 'border-2 border-dashed border-amber-500/70' : 'border border-zinc-700'
        }`}
      />
      {img.isReference && (
        <span className="absolute -bottom-1 -right-1 bg-amber-500 text-black text-[8px] leading-none font-bold px-1 py-0.5 rounded shadow">
          REF
        </span>
      )}
    </div>
  )
}

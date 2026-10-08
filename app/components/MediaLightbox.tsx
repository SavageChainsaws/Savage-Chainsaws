'use client'

// Quick zoomed-in preview overlay for the Diagnosis Findings thumbnails
// shown in the customer portal's Repair Decision Needed card - lets a
// customer see the damage/findings close up without navigating away.
export default function MediaLightbox({
  media,
  onClose,
}: {
  media: { url: string; isVideo: boolean; caption: string | null } | null
  onClose: () => void
}) {
  if (!media) return null
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 cursor-zoom-out"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 text-white text-2xl leading-none h-10 w-10 flex items-center justify-center rounded-full bg-zinc-800/80 hover:bg-zinc-700"
        aria-label="Close preview"
      >
        &times;
      </button>
      {media.isVideo ? (
        <video
          src={media.url}
          controls
          autoPlay
          onClick={e => e.stopPropagation()}
          className="max-h-[85vh] max-w-full rounded-lg"
        />
      ) : (
        <img
          src={media.url}
          alt={media.caption || 'Diagnosis photo'}
          onClick={e => e.stopPropagation()}
          className="max-h-[85vh] max-w-full object-contain rounded-lg"
        />
      )}
    </div>
  )
}

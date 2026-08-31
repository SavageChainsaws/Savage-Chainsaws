import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Savage Chainsaws',
    short_name: 'Savage Chainsaws',
    description: 'Unit tracking for Savage Chainsaws customers',
    start_url: '/login',
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#f97316',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
      // Android's adaptive-icon masking (circle/squircle/rounded-square) can
      // clip a plain icon's edges - this variant pads the badge into the
      // center ~80% safe zone on the same solid black background so nothing
      // important gets cropped.
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
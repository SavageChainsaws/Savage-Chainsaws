import type { Metadata } from 'next'
import './globals.css'

// iOS shows a launch splash screen built from these device-specific images
// while the PWA cold-starts after being added to the home screen; there is
// no single "one size fits all" - Safari picks the one matching the exact
// device/orientation media query.
const appleSplashScreens = [
  { file: 'apple-splash-640x1136.png', media: '(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)' },
  { file: 'apple-splash-1136x640.png', media: '(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)' },
  { file: 'apple-splash-750x1334.png', media: '(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)' },
  { file: 'apple-splash-1334x750.png', media: '(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)' },
  { file: 'apple-splash-1242x2208.png', media: '(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)' },
  { file: 'apple-splash-2208x1242.png', media: '(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)' },
  { file: 'apple-splash-1125x2436.png', media: '(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)' },
  { file: 'apple-splash-2436x1125.png', media: '(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)' },
  { file: 'apple-splash-828x1792.png', media: '(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)' },
  { file: 'apple-splash-1792x828.png', media: '(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)' },
  { file: 'apple-splash-1242x2688.png', media: '(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)' },
  { file: 'apple-splash-2688x1242.png', media: '(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)' },
  { file: 'apple-splash-1170x2532.png', media: '(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)' },
  { file: 'apple-splash-2532x1170.png', media: '(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)' },
  { file: 'apple-splash-1284x2778.png', media: '(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)' },
  { file: 'apple-splash-2778x1284.png', media: '(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)' },
  { file: 'apple-splash-1179x2556.png', media: '(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)' },
  { file: 'apple-splash-2556x1179.png', media: '(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)' },
  { file: 'apple-splash-1290x2796.png', media: '(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)' },
  { file: 'apple-splash-2796x1290.png', media: '(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)' },
].map(({ file, media }) => ({ url: `/splash/${file}`, media }))

export const metadata: Metadata = {
  title: 'Savage Chainsaws',
  description: 'Chainsaw Precision by Jesse - Unit Tracking',
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    title: 'Savage Chainsaws',
    statusBarStyle: 'black-translucent',
    startupImage: appleSplashScreens,
  },
  other: {
    // Next only emits the unprefixed mobile-web-app-capable tag; keep the
    // legacy Apple-prefixed one too since it's what older iOS looks for.
    'apple-mobile-web-app-capable': 'yes',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-white antialiased">
        {children}
      </body>
    </html>
  )
}
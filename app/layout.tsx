import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Savage Chainsaws',
  description: 'Chainsaw Precision by Jesse - Unit Tracking',
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
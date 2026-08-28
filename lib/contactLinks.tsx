import type { ReactNode } from 'react'

export type ContactLink = {
  key: string
  label: string
  href: string
  // true for links that leave the app (social/maps/website); false for
  // mailto:/tel: links, where a new tab doesn't make sense.
  external: boolean
  icon: ReactNode
}

function TikTokIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-full w-full">
      <path d="M12.5 2h2.7c.2 1.6 1.1 3 2.5 3.8.7.4 1.5.6 2.3.6v2.8c-1.6 0-3.1-.5-4.4-1.4v6.6c0 3.1-2.5 5.6-5.6 5.6S4.4 17.5 4.4 14.4 6.9 8.8 10 8.8c.3 0 .6 0 .9.1v2.9c-.3-.1-.6-.2-.9-.2-1.5 0-2.7 1.2-2.7 2.7s1.2 2.7 2.7 2.7 2.7-1.2 2.7-2.7V2z" />
    </svg>
  )
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-full w-full">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 3.8 5.7 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.7-3.8-9S9.5 5.5 12 3Z" />
    </svg>
  )
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-full w-full">
      <path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
    </svg>
  )
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-full w-full">
      <path d="M2.25 6.75c0 8.284 6.716 15 15 15h1.5a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106a2.25 2.25 0 00-2.238.652l-.933.933a11.25 11.25 0 01-5.865-5.865l.933-.933a2.25 2.25 0 00.653-2.238L6.16 3.102a1.125 1.125 0 00-1.091-.852H3.75A1.5 1.5 0 002.25 3.75v3z" />
    </svg>
  )
}

function MapPinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-full w-full">
      <path d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
      <path d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
    </svg>
  )
}

// Add Facebook/Instagram/etc. here later - same shape (key, label, href,
// external, icon) - both ContactLinksBar variants pick them up
// automatically, no other changes needed.
export const CONTACT_LINKS: ContactLink[] = [
  {
    key: 'tiktok',
    label: 'TikTok',
    href: 'https://www.tiktok.com/@radfj40',
    external: true,
    icon: <TikTokIcon />,
  },
  {
    key: 'website',
    label: 'savagechainsaws.com',
    href: 'https://savagechainsaws.com',
    external: true,
    icon: <GlobeIcon />,
  },
  {
    key: 'email',
    label: 'savagechainsaws@gmail.com',
    href: 'mailto:savagechainsaws@gmail.com',
    external: false,
    icon: <MailIcon />,
  },
  {
    key: 'phone',
    label: '(407) 375-8199',
    href: 'tel:+14073758199',
    external: false,
    icon: <PhoneIcon />,
  },
  {
    key: 'address',
    label: '1607 South Orlando Ave, Maitland, FL 32751',
    href: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('1607 South Orlando Ave, Maitland, FL 32751'),
    external: true,
    icon: <MapPinIcon />,
  },
]

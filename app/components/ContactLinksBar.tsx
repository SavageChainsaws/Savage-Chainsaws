import { CONTACT_LINKS } from '@/lib/contactLinks'

// 'compact' -> icon-only pills for a header bar. 'full' -> icon + label
// rows for a footer. Both read from the same CONTACT_LINKS list, so adding
// a new entry there (Facebook, Instagram, etc.) shows up in both places
// automatically.
export default function ContactLinksBar({ variant = 'compact' }: { variant?: 'compact' | 'full' }) {
  return (
    <div className={variant === 'compact' ? 'flex items-center gap-2 flex-wrap' : 'flex flex-wrap gap-x-5 gap-y-2'}>
      {CONTACT_LINKS.map(link => (
        <a
          key={link.key}
          href={link.href}
          {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          title={link.label}
          className={
            variant === 'compact'
              ? 'h-8 w-8 flex items-center justify-center rounded-lg border border-zinc-700 text-gray-400 hover:text-orange-400 hover:border-orange-500 transition shrink-0'
              : 'flex items-center gap-2 text-xs text-gray-400 hover:text-orange-400 transition'
          }
        >
          <span className={variant === 'compact' ? 'h-4 w-4' : 'h-4 w-4 shrink-0'}>{link.icon}</span>
          {variant === 'full' && <span>{link.label}</span>}
        </a>
      ))}
    </div>
  )
}

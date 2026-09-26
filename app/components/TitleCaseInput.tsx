'use client'

import { useState } from 'react'
import { toTitleCase, liveTitleCase } from '@/lib/text'

// Live client-side counterpart to lib/text.ts's toTitleCase - keeps names
// and short labels consistent as Jesse types them ("john smith" becomes
// "John Smith" immediately), rather than only normalizing on the server
// after submit. Mirrors UppercaseInput's pattern (forces the actual stored
// value, not just a CSS text-transform) for the same reason: a CSS-only
// transform would leave the underlying value mixed-case wherever it's read
// back out (PDFs, other admin views, exports).
export default function TitleCaseInput({
  name,
  defaultValue = '',
  placeholder,
  required,
  className,
}: {
  name: string
  defaultValue?: string
  placeholder?: string
  required?: boolean
  className?: string
}) {
  const [value, setValue] = useState(toTitleCase(defaultValue))
  return (
    <input
      name={name}
      value={value}
      onChange={e => setValue(liveTitleCase(e.target.value))}
      placeholder={placeholder}
      required={required}
      className={className}
    />
  )
}

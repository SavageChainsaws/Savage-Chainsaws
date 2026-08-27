'use client'

import { useState } from 'react'

// Forces the actual stored value to uppercase as the user types, matching
// how Model fields are handled elsewhere in the app (not a CSS-only
// text-transform, which would leave the underlying value mixed-case).
export default function UppercaseInput({
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
  const [value, setValue] = useState(defaultValue.toUpperCase())
  return (
    <input
      name={name}
      value={value}
      onChange={e => setValue(e.target.value.toUpperCase())}
      placeholder={placeholder}
      required={required}
      className={className}
    />
  )
}

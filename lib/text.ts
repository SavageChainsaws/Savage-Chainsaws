// Shared text-normalization rules, applied wherever a person/business name
// or email is written to the database - so "john smith", "JOHN SMITH", and
// "John smith" all end up stored (and therefore displayed everywhere:
// invoices, PDFs, customer lists) the same way, rather than whatever case
// each admin happened to type. Never applied to technical identifiers
// (equipment model/serial numbers, referral codes) - those have their own
// correct casing that this would break.

// Common business-entity suffixes that must stay fully uppercase however
// they were typed (llc/Llc/LLC all become "LLC") - naive per-word title
// casing would otherwise turn "LLC" into "Llc".
// "CO" is deliberately excluded - the conventional abbreviation for
// "Company" is mixed-case "Co" (e.g. "Smith & Co"), not all-caps, unlike
// these, which are always fully uppercase however they're typed.
const BUSINESS_SUFFIXES = new Set(['LLC', 'LLP', 'LLLP', 'PLLC', 'INC', 'CORP', 'LTD', 'PC'])

// Capitalizes only the first letter and any letter right after a hyphen
// ("mary-jane" -> "Mary-Jane") - deliberately not after an apostrophe,
// since a plain possessive ("kayla's") must stay "Kayla's", not "Kayla'S",
// and that's far more common in real customer names than a surname like
// O'Brien needing the same treatment after an apostrophe.
function recapitalize(word: string): string {
  return word.toLowerCase().replace(/(^|-)\p{L}/gu, m => m.toUpperCase())
}

// Title-cases a name, but only ever touches a word that was typed in one
// uniform case (all caps from Caps Lock, or all lowercase from not
// bothering with Shift) - real names routinely mix case on purpose
// (DeAngelo, McDonald, iPhone) in ways a naive capitalizer can't tell
// apart from a typo, so any word already mixing upper and lower case
// beyond its first letter is left completely untouched.
export function toTitleCase(input: string): string {
  return input
    .trim()
    .split(/\s+/)
    .map(word => {
      if (!word) return word
      const lettersOnly = word.replace(/[^\p{L}]/gu, '')
      if (!lettersOnly) return word
      if (BUSINESS_SUFFIXES.has(lettersOnly.toUpperCase())) return word.toUpperCase()
      const hasLower = /\p{Ll}/u.test(word)
      const hasInteriorUpper = /\p{Lu}/u.test(word.slice(1))
      if (hasLower && hasInteriorUpper) return word
      return recapitalize(word)
    })
    .join(' ')
}

// Live, per-keystroke counterpart to toTitleCase for controlled inputs (see
// TitleCaseInput) - deliberately does NOT trim or collapse whitespace like
// toTitleCase does, since doing that on every keystroke would delete the
// trailing space the instant someone types it, making it impossible to ever
// start a second word. Recapitalizes each word in place via a direct regex
// replace instead of split/rejoin, so whitespace (including a trailing
// space mid-typing) passes through completely untouched. Finalizing
// (trimming, collapsing runs of whitespace) still happens server-side via
// toTitleCase when the value is actually saved.
export function liveTitleCase(input: string): string {
  return input.replace(/\p{L}[\p{L}'-]*/gu, word => {
    if (BUSINESS_SUFFIXES.has(word.toUpperCase())) return word.toUpperCase()
    const hasLower = /\p{Ll}/u.test(word)
    const hasInteriorUpper = /\p{Lu}/u.test(word.slice(1))
    if (hasLower && hasInteriorUpper) return word
    return recapitalize(word)
  })
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase()
}

'use client'

import { useEffect, useRef, useState } from 'react'

// Drop-in replacement for a plain <textarea> that adds a tap-to-talk mic
// button in the corner - for Jesse writing up what a unit's going through
// while he's out in the field instead of typing it all on a phone
// keyboard. Works as a controlled (value/onChange) or uncontrolled
// (defaultValue) textarea exactly like the native element, since callers
// use it both ways (see CreateCustomInvoiceForm/EditInvoiceForm vs.
// CreateUnitInvoiceForm/NotesForm).
//
// Uses the browser's SpeechRecognition API directly (no server round-trip,
// no API key) - well-supported on Chrome/Android, but notoriously
// unreliable on iOS Safari specifically. The mic button only renders at
// all when the browser actually exposes the API, so on an iPhone where it
// doesn't work this just quietly isn't there - the keyboard's own
// dictation button (tap the mic icon next to the emoji key) is the
// reliable path there and needs nothing from this component.
export default function DictateTextarea({
  className,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)
  const [isListening, setIsListening] = useState(false)
  const [supported, setSupported] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition))
  }, [])

  // Stop listening if the component unmounts mid-dictation (e.g. the
  // invoice modal gets closed) rather than leaving the mic running.
  useEffect(() => () => recognitionRef.current?.stop(), [])

  // Inserts text at the cursor using the real DOM <textarea>, then fires a
  // native 'input' event so a controlled parent's onChange still sees it -
  // React only tracks its own synthetic setValue calls, not a ref
  // mutation, so writing el.value directly wouldn't otherwise trigger it.
  function insertText(text: string) {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    const before = el.value.slice(0, start)
    const after = el.value.slice(end)
    const needsSpace = before.length > 0 && !/[\s\n]$/.test(before)
    const insert = (needsSpace ? ' ' : '') + text
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
    nativeSetter?.call(el, before + insert + after)
    const newCursor = (before + insert).length
    el.setSelectionRange(newCursor, newCursor)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.focus()
  }

  function toggleListening() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) return
    if (isListening) {
      recognitionRef.current?.stop()
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang = 'en-US'
    recognition.continuous = true
    recognition.interimResults = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let finalText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript
      }
      if (finalText.trim()) insertText(finalText.trim())
    }
    recognition.onerror = () => setIsListening(false)
    recognition.onend = () => setIsListening(false)
    recognition.start()
    recognitionRef.current = recognition
    setIsListening(true)
  }

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        {...rest}
        className={`${className || ''} ${supported ? 'pr-10' : ''}`}
      />
      {supported && (
        <button
          type="button"
          onClick={toggleListening}
          title={isListening ? 'Stop dictating' : 'Tap and talk - fills the notes for you'}
          aria-label={isListening ? 'Stop dictating' : 'Dictate notes'}
          className={`absolute right-2 top-2 w-7 h-7 rounded-full flex items-center justify-center text-sm transition ${
            isListening
              ? 'bg-red-600 text-white animate-pulse'
              : 'bg-zinc-800 border border-zinc-700 text-orange-400 hover:bg-zinc-700'
          }`}
        >
          🎤
        </button>
      )}
    </div>
  )
}

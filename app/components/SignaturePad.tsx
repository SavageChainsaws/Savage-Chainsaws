'use client'

import { useEffect, useRef, useState } from 'react'

// Finger/mouse draw-to-sign box - used both for a customer signing a
// rental agreement in person (see RentalAgreementSignScreen) and for Jesse
// saving his own signature once in Shop Settings to auto-stamp onto every
// agreement after (see OwnerSignatureSetting). Draws on a canvas sized to
// its displayed CSS size times devicePixelRatio so it stays crisp on a
// phone screen, and exports a transparent-background PNG data URL -
// callers upload that themselves (see CreateRentalAgreementFlow) rather
// than this component doing any network work.
export default function SignaturePad({
  onChange,
  height = 160,
}: {
  // Fires with null the moment the pad is cleared/empty, or a PNG data URL
  // after a stroke ends - callers use this to gate their own "no empty
  // signature" validation rather than this component enforcing it.
  onChange: (dataUrl: string | null) => void
  height?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const [isEmpty, setIsEmpty] = useState(true)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * ratio
    canvas.height = rect.height * ratio
    const ctx = canvas.getContext('2d')
    ctx?.scale(ratio, ratio)
  }, [])

  function getPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault()
    canvasRef.current?.setPointerCapture(e.pointerId)
    drawingRef.current = true
    lastPointRef.current = getPoint(e)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    e.preventDefault()
    const ctx = canvasRef.current?.getContext('2d')
    const from = lastPointRef.current
    const to = getPoint(e)
    if (!ctx || !from) return
    ctx.strokeStyle = '#1a1a1a'
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
    lastPointRef.current = to
    setIsEmpty(false)
  }

  function handlePointerUp() {
    if (!drawingRef.current) return
    drawingRef.current = false
    lastPointRef.current = null
    onChange(canvasRef.current?.toDataURL('image/png') || null)
  }

  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    setIsEmpty(true)
    onChange(null)
  }

  return (
    <div>
      <div className="relative bg-white rounded-lg border-2 border-dashed border-zinc-600 overflow-hidden touch-none" style={{ height }}>
        <canvas
          ref={canvasRef}
          className="w-full h-full touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
        {isEmpty && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-400 pointer-events-none">
            Sign here with your finger or mouse
          </p>
        )}
      </div>
      <button type="button" onClick={clear} className="text-xs text-orange-400 hover:text-orange-300 mt-1.5">
        Clear
      </button>
    </div>
  )
}

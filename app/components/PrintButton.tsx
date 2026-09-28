'use client'

export default function PrintButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={className || 'bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg print:hidden'}
    >
      Print
    </button>
  )
}

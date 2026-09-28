'use client'

import { useState } from 'react'

export default function PartsImportForm() {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return

    setLoading(true)
    setMessage(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/parts/import', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (response.ok) {
        setMessage({
          type: 'success',
          text: `Imported ${result.imported} parts successfully!${result.updated ? ` (${result.updated} updated)` : ''}`,
        })
        setFile(null)
        ;(e.target as HTMLFormElement).reset()
      } else {
        setMessage({
          type: 'error',
          text: result.error || 'Failed to import parts',
        })
      }
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Upload failed',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-green-300 mb-2">
          Upload Parts Pricing File (Excel)
        </label>
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-green-600 file:text-white hover:file:bg-green-500"
        />
        <p className="text-xs text-gray-500 mt-2">
          Expected columns: SKU, Description, Cost, Retail Price
        </p>
      </div>

      <button
        type="submit"
        disabled={!file || loading}
        className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition"
      >
        {loading ? 'Importing...' : 'Import Parts Data'}
      </button>

      {message && (
        <div
          className={`p-3 rounded-lg text-sm ${
            message.type === 'success'
              ? 'bg-green-500/10 border border-green-500/30 text-green-300'
              : 'bg-red-500/10 border border-red-500/30 text-red-300'
          }`}
        >
          {message.text}
        </div>
      )}
    </form>
  )
}

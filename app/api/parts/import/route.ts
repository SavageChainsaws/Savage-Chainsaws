import { getSessionInfo } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

// Simple CSV parser
function parseCSV(text: string): string[][] {
  const lines = text.trim().split('\n')
  return lines.map((line) => {
    // Handle quoted fields
    const result: string[] = []
    let current = ''
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      const nextChar = line[i + 1]

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    result.push(current.trim())
    return result
  })
}

// POST endpoint to import parts from CSV/Excel file
export async function POST(req: NextRequest) {
  try {
    const { supabase, isAdmin } = await getSessionInfo()
    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: 'Not authorized' }),
        { status: 403 }
      )
    }

    const formData = await req.formData()
    const file = formData.get('file') as File
    if (!file) {
      return new Response(
        JSON.stringify({ error: 'No file provided' }),
        { status: 400 }
      )
    }

    // Read file content
    const text = await file.text()
    const rows = parseCSV(text)

    if (rows.length < 2) {
      return new Response(
        JSON.stringify({ error: 'File must have header row and at least one data row' }),
        { status: 400 }
      )
    }

    // Parse header row
    const header = rows[0].map((h) => h.toLowerCase().trim())
    const skuIdx = header.findIndex((h) => h.includes('sku'))
    const descIdx = header.findIndex((h) => h.includes('description') || h.includes('desc'))
    const costIdx = header.findIndex((h) => h.includes('cost'))
    const retailIdx = header.findIndex((h) => h.includes('retail') || h.includes('price'))

    if (skuIdx === -1 || descIdx === -1 || costIdx === -1 || retailIdx === -1) {
      return new Response(
        JSON.stringify({
          error: 'Missing required columns. Expected: SKU, Description, Cost, Retail Price',
        }),
        { status: 400 }
      )
    }

    // Parse data rows
    const parts = []
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      if (row.length === 0 || row.every((cell) => !cell)) continue // Skip empty rows

      const sku = row[skuIdx]?.toUpperCase().trim()
      const description = row[descIdx]?.trim()
      const cost = parseFloat(row[costIdx])
      const retail = parseFloat(row[retailIdx])

      if (!sku || !description || !Number.isFinite(cost) || !Number.isFinite(retail)) {
        console.warn(`Skipping invalid row ${i}: ${JSON.stringify(row)}`)
        continue
      }

      parts.push({ sku, description, cost, retail_price: retail })
    }

    if (parts.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No valid data rows found' }),
        { status: 400 }
      )
    }

    // Upsert parts into database
    let imported = 0
    let updated = 0

    for (const part of parts) {
      const { error: upsertError, data: result } = await supabase
        .from('parts_catalog')
        .upsert(
          {
            sku: part.sku,
            description: part.description,
            cost: part.cost,
            retail_price: part.retail_price,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'sku' }
        )
        .select()

      if (upsertError) {
        console.error(`Error upserting part ${part.sku}:`, upsertError)
        continue
      }

      if (result && result.length > 0) {
        // Check if it was an update or insert by checking if the part existed before
        // For simplicity, we'll just count all operations
        imported++
      }
    }

    return new Response(
      JSON.stringify({
        imported: imported,
        updated: 0,
        total: parts.length,
        message: `Successfully imported ${imported}/${parts.length} parts`,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Parts import error:', error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to import parts',
      }),
      { status: 500 }
    )
  }
}

import { getSessionInfo } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

// POST endpoint to look up parts by SKU
// Returns found parts and list of SKUs not found
export async function POST(req: NextRequest) {
  try {
    const { supabase } = await getSessionInfo()
    const { skus } = await req.json()

    if (!Array.isArray(skus) || skus.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid SKU list' }),
        { status: 400 }
      )
    }

    // Normalize SKUs to uppercase
    const normalizedSkus = skus.map((sku: string) => sku.toUpperCase().trim())

    // Query for parts matching the SKUs
    const { data: foundParts, error } = await supabase
      .from('parts_catalog')
      .select('sku, description, cost, retail_price, category')
      .in('sku', normalizedSkus)

    if (error) {
      return new Response(
        JSON.stringify({ error: 'Failed to look up parts' }),
        { status: 500 }
      )
    }

    // Determine which SKUs were found
    const foundSkus = new Set((foundParts || []).map((p: any) => p.sku))
    const notFoundSkus = normalizedSkus.filter((sku: string) => !foundSkus.has(sku))

    return new Response(
      JSON.stringify({
        found: foundParts || [],
        notFound: notFoundSkus,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Parts lookup error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500 }
    )
  }
}

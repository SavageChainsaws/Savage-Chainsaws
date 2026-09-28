import { getSessionInfo } from '@/lib/supabase/server'

// Public endpoint to fetch the parts pricing catalog
// Used by the order sheet component to show available parts
export async function GET() {
  try {
    const { supabase } = await getSessionInfo()

    // Fetch all parts from the parts_catalog table
    const { data: parts, error } = await supabase
      .from('parts_catalog')
      .select('sku, description, cost, retail_price, category')
      .order('sku', { ascending: true })

    if (error) {
      return new Response(
        JSON.stringify({ error: 'Failed to load parts catalog' }),
        { status: 500 }
      )
    }

    return new Response(
      JSON.stringify({ parts: parts || [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Parts catalog error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500 }
    )
  }
}

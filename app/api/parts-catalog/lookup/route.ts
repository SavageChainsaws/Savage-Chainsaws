import { NextRequest, NextResponse } from 'next/server'
import { getSessionInfo } from '@/lib/supabase/server'

// Backs the SKU-autofill on invoice Parts rows (see InvoiceItemGroup) - type
// or paste a real STIHL SKU into a Parts description field and this fills
// in the catalog description + retail price, the same pricing source the
// per-unit Order Sheet already uses. Admin-only, matching every other
// parts_catalog read path (no anon access - see the migration that created
// this table).
export async function GET(request: NextRequest) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const sku = (request.nextUrl.searchParams.get('sku') || '').trim()
  if (!sku) {
    return NextResponse.json({ match: null })
  }

  const { data } = await supabase
    .from('parts_catalog')
    .select('sku, description, cost, retail_price')
    .ilike('sku', sku)
    .maybeSingle()

  return NextResponse.json({ match: data || null })
}

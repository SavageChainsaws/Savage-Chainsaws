import { NextRequest, NextResponse } from 'next/server'
import { getSessionInfo } from '@/lib/supabase/server'

// Backs the SKU-autofill on invoice Parts rows (see InvoiceItemGroup) - type
// or paste a real SKU into a Parts description field and this fills in the
// catalog description + retail price, the same pricing source the per-unit
// Order Sheet already uses. Admin-only, matching every other parts_catalog/
// rotary_parts read path (no anon access - see the migrations that created
// these tables).
//
// Checks parts_catalog (STIHL) first, then rotary_parts as a fallback - a
// real Rotary SKU (e.g. 9212114, a 14" guide bar) used to come back as no
// match at all and silently leave the line at its $0.00 placeholder, since
// this route only ever queried parts_catalog. app/api/bot/unit/parts/
// catalog/route.ts already checked both tables for Unit Bot's own SKU
// lookup - this route just never matched it, despite its own old comment
// claiming the two mirrored each other.
export async function GET(request: NextRequest) {
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const sku = (request.nextUrl.searchParams.get('sku') || '').trim()
  if (!sku) {
    return NextResponse.json({ match: null })
  }

  const { data: stihlMatch } = await supabase
    .from('parts_catalog')
    .select('sku, description, cost, retail_price')
    .ilike('sku', sku)
    .maybeSingle()
  if (stihlMatch) {
    return NextResponse.json({ match: stihlMatch })
  }

  const { data: rotaryMatch } = await supabase
    .from('rotary_parts')
    .select('sku, description, cost, retail_price')
    .ilike('sku', sku)
    .maybeSingle()

  return NextResponse.json({ match: rotaryMatch || null })
}

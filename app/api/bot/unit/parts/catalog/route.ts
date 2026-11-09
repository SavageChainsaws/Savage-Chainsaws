import { NextRequest, NextResponse } from 'next/server'
import { withBotAuth, jsonError } from '@/lib/bot/respond'
import { logBotAction } from '@/lib/bot/audit'
import { escapeLikePattern } from '@/lib/units'

// Read-only, deliberately - there is no POST/PATCH/DELETE anywhere in this
// file. Unit Bot may look up catalog pricing/descriptions to help decide
// what SKU to record on a unit override, but it can never change a price
// in parts_catalog or rotary_parts - those stay admin-only, same as the
// existing admin SKU-autofill route (app/api/parts-catalog/lookup/route.ts)
// this mirrors the read behavior of. An exact ?sku= match checks
// parts_catalog, then rotary_parts (plus oem_cross_references, which maps
// a third-party OEM SKU to Rotary's own equivalent); ?q= does a broader
// substring search across both catalogs' description field.
export async function GET(request: NextRequest) {
  return withBotAuth(request, 'unit_bot', 'GET /api/bot/unit/parts/catalog', async ({ admin, botName }) => {
    const { searchParams } = request.nextUrl
    const sku = (searchParams.get('sku') || '').trim()
    const q = (searchParams.get('q') || '').trim()

    if (sku) {
      const pattern = escapeLikePattern(sku)
      const [catalog, rotary, oemCrossRef] = await Promise.all([
        admin.from('parts_catalog').select('sku, description, retail_price, category').ilike('sku', pattern).maybeSingle(),
        admin.from('rotary_parts').select('sku, description, retail_price, category').ilike('sku', pattern).maybeSingle(),
        admin.from('oem_cross_references').select('oem_brand, oem_sku, rotary_sku').ilike('oem_sku', pattern).limit(10),
      ])
      await logBotAction(admin, { botName, action: 'parts_catalog_read', endpoint: 'GET /api/bot/unit/parts/catalog', outcome: 'success', detail: { sku } })
      return NextResponse.json({
        parts_catalog_match: catalog.data || null,
        rotary_parts_match: rotary.data || null,
        oem_cross_references: oemCrossRef.data || [],
      })
    }

    if (q) {
      const pattern = `%${escapeLikePattern(q)}%`
      const [catalog, rotary] = await Promise.all([
        admin.from('parts_catalog').select('sku, description, retail_price, category').ilike('description', pattern).limit(25),
        admin.from('rotary_parts').select('sku, description, retail_price, category').ilike('description', pattern).limit(25),
      ])
      await logBotAction(admin, { botName, action: 'parts_catalog_read', endpoint: 'GET /api/bot/unit/parts/catalog', outcome: 'success', detail: { q } })
      return NextResponse.json({ parts_catalog: catalog.data || [], rotary_parts: rotary.data || [] })
    }

    return jsonError(400, 'Provide either ?sku= or ?q=.')
  })
}

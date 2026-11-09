import { NextRequest, NextResponse } from 'next/server'
import { withBotAuth, jsonError } from '@/lib/bot/respond'
import { logBotAction } from '@/lib/bot/audit'
import { escapeLikePattern } from '@/lib/units'

// Read-only - factory spec-sheet reference data (carb/torque specs,
// scanned from STIHL technical documentation), filterable by model or
// category. No write endpoint exists or should.
export async function GET(request: NextRequest) {
  return withBotAuth(request, 'unit_bot', 'GET /api/bot/unit/equipment-spec-sheets', async ({ admin, botName }) => {
    const { searchParams } = request.nextUrl
    const model = searchParams.get('model')
    const category = searchParams.get('category')

    let query = admin.from('equipment_spec_sheets').select('*').order('page_number').limit(200)
    if (model) query = query.contains('models', [model])
    if (category) query = query.ilike('category', escapeLikePattern(category))

    const { data, error } = await query
    if (error) return jsonError(500, error.message)
    await logBotAction(admin, { botName, action: 'equipment_spec_sheets_read', endpoint: 'GET /api/bot/unit/equipment-spec-sheets', outcome: 'success', detail: { count: data?.length ?? 0 } })
    return NextResponse.json({ equipment_spec_sheets: data || [] })
  })
}

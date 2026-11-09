import { describe, it, expect } from 'vitest'
import * as units from './units/route'
import * as unitsById from './units/[id]/route'
import * as serviceHistory from './service-history/route'
import * as serviceHistoryById from './service-history/[id]/route'
import * as modelParts from './parts/model-parts/route'
import * as unitOverrides from './parts/unit-overrides/route'
import * as catalog from './parts/catalog/route'
import * as specSheets from './equipment-spec-sheets/route'
import * as photos from './photos/route'
import * as notes from './notes/route'

// Unit Bot's hard limit is "no DELETE anywhere, archive only via
// units.archived" - this is enforced simply by never writing a DELETE
// handler in any of these files, but that's exactly the kind of thing a
// future edit could add back without anyone noticing. This test fails
// loudly the moment any of these modules ever exports one.
const unitBotRouteModules: [string, Record<string, unknown>][] = [
  ['units/route', units],
  ['units/[id]/route', unitsById],
  ['service-history/route', serviceHistory],
  ['service-history/[id]/route', serviceHistoryById],
  ['parts/model-parts/route', modelParts],
  ['parts/unit-overrides/route', unitOverrides],
  ['parts/catalog/route', catalog],
  ['equipment-spec-sheets/route', specSheets],
  ['photos/route', photos],
  ['notes/route', notes],
]

describe('Unit Bot routes never implement DELETE', () => {
  it.each(unitBotRouteModules)('%s has no DELETE export', (_path, mod) => {
    expect(mod.DELETE).toBeUndefined()
  })
})

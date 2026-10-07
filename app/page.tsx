import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import Link from 'next/link'
import { createClient, getSessionInfo } from '@/lib/supabase/server'
import InactivityRedirect from './components/InactivityRedirect'
import LastViewedBanner from './components/LastViewedBanner'
import ScrollToOpenUnit from './components/ScrollToOpenUnit'
import AdminLogout from './components/AdminLogout'
import DeleteUnitButton from './components/DeleteUnitButton'
import NotesForm from './components/NotesForm'
import ThumbnailForm from './components/ThumbnailForm'
import CheckInForm from './components/CheckInForm'
import { UnitPhoto } from './components/UnitPhoto'
import { UnitPhotoGallery } from './components/UnitPhotoGallery'
import { BeforeAfterCompare } from './components/BeforeAfterCompare'
import UnitPhotoUpload from './components/UnitPhotoUpload'
import UppercaseInput from './components/UppercaseInput'
import ContactLinksBar from './components/ContactLinksBar'
import SiteFooter from './components/SiteFooter'
import { resolveUnitParts } from '@/lib/parts'
import { toTitleCase, normalizeEmail } from '@/lib/text'
import {
  unitLabel,
  isUnderWarranty,
  getFleetColor,
  equipmentGroup,
  groupLabel,
  PRIORITY_FEE,
} from '@/lib/units'
import { formatDate, formatShortDate } from '@/lib/dates'
import { hexToRgba } from '@/lib/color'
import CreateCustomerLoginForm from './components/CreateCustomerLoginForm'
import DeleteCustomerLoginForm from './components/DeleteCustomerLoginForm'
import CreateReferralSourceLoginForm from './components/CreateReferralSourceLoginForm'
import DeleteReferralSourceLoginForm from './components/DeleteReferralSourceLoginForm'
import CopyReferralLink from './components/CopyReferralLink'
import CopyInstantSignupLink from './components/CopyInstantSignupLink'
import CreateCustomInvoiceForm from './components/CreateCustomInvoiceForm'
import ShopSettingsForm from './components/ShopSettingsForm'
import EditCustomerButton from './components/EditCustomerButton'
import CreateUnitInvoiceForm from './components/CreateUnitInvoiceForm'
import EditInvoiceForm from './components/EditInvoiceForm'
import TitleCaseInput from './components/TitleCaseInput'
import { UnitStatusProvider, StatusSelect, DiagnosisNotesField } from './components/UnitStatusFields'
import { UnitIdentityProvider, UnitDescriptionField, UnitIdentityBox, WarrantyBox } from './components/UnitIdentityFields'
import DiagnosisMediaUpload from './components/DiagnosisMediaUpload'
import PriorityCheckbox from './components/PriorityCheckbox'
import PushToggle from './components/PushToggle'
import { getDefaultTaxRatePercent, parseInvoiceLineItemsForEdit } from '@/lib/billing'
import {
  addOrderSheetItem,
  updateOrderSheetItemQuantity,
  deleteOrderSheetItem,
  clearOrderSheet,
} from './actions/orderSheet'
import { addServiceHistoryEntry, deleteServiceHistoryEntry } from './actions/serviceHistory'
import { upsertUnitPartOverride, deleteUnitPartOverride } from './actions/unitParts'
import { addUnitPhoto, deleteUnitPhoto, addDiagnosisMedia } from './actions/unitPhotos'
import { updateShopSetting, regenerateInstantSignupToken } from './actions/shopSettings'
import {
  createCustomerLogin,
  deleteCustomerLogin,
  createReferralSourceLogin,
  deleteReferralSourceLogin,
} from './actions/customerLogins'
import { addUnit, addFleetUnit, updateFleetUnit, updateUnitIdentity, updateUnitWarranty } from './actions/fleetCheckIn'
import {
  scheduleFleetService,
  returnToFleet,
  markPickedUp,
  updateStatus,
  markDecisionSeen,
  snoozeUnit,
  nudgeUnit,
  replyToMessage,
  updateNotes,
  updateThumbnail,
} from './actions/unitWorkflow'

type UpdateCustomerState = { success: boolean; message: string } | null

// Edits an existing customer's own contact fields - name, portal login
// email, secondary email, phone. Deliberately never touches auth_user_id:
// that's only ever set by createCustomerLogin (app/actions/customerLogins.ts),
// so editing the email
// here does NOT change which Auth account (or its actual login
// credentials) the customer row is linked to. If a login already exists
// and its real Auth email needs to change too, re-run "Create Customer
// Login" for the same customer afterward to keep them in sync - the form
// below says as much next to the email field.
async function updateCustomerDetails(_prevState: UpdateCustomerState, formData: FormData): Promise<UpdateCustomerState> {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const id = (formData.get('id') as string) || ''
  if (!id) return { success: false, message: 'Missing customer id.' }

  const nameRaw = ((formData.get('name') as string) || '').trim()
  if (!nameRaw) return { success: false, message: 'Name is required.' }
  const name = toTitleCase(nameRaw)

  const emailRaw = ((formData.get('email') as string) || '').trim()
  const email = emailRaw ? normalizeEmail(emailRaw) : null

  const secondaryEmailRaw = ((formData.get('secondary_email') as string) || '').trim()
  const secondaryEmail = secondaryEmailRaw ? normalizeEmail(secondaryEmailRaw) : null

  const phone = ((formData.get('phone') as string) || '').trim() || null
  const paymentPlansEnabled = formData.get('payment_plans_enabled') === 'on'

  const { error } = await supabase
    .from('customers')
    .update({ name, email, secondary_email: secondaryEmail, phone, payment_plans_enabled: paymentPlansEnabled })
    .eq('id', id)
  if (error) return { success: false, message: `Could not save: ${error.message}` }

  revalidatePath('/')
  return { success: true, message: 'Customer updated.' }
}


// Compact read-at-a-glance indicator for the Fleet Units list - these are
// already-completed fleet units, not something to edit from this list, so
// this is deliberately just an icon rather than the interactive Yes/No/
// Save WarrantyBox control used on the Repair Flow header above. Same
// isUnderWarranty()/warranty_end data, just a lighter-weight presentation.
// Always rendered (not hidden when false) - filled/blue when under
// warranty, outlined/grey when not - so it's a glanceable two-state
// indicator rather than something that's only ever present or absent.
function WarrantyIcon({ underWarranty, title }: { underWarranty: boolean; title: string }) {
  return (
    <span title={title} className={`shrink-0 ${underWarranty ? 'text-blue-400' : 'text-zinc-600'}`}>
      <svg
        viewBox="0 0 24 24"
        fill={underWarranty ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
      >
        <path d="M12 2 4 5v6c0 5 3.4 8.7 8 11 4.6-2.3 8-6 8-11V5l-8-3Z" />
        {underWarranty && <path d="m9 12 2 2 4-4" stroke="#09090b" />}
      </svg>
    </span>
  )
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string; status?: string; open?: string }>
}) {
  const { supabase, user, isAdmin } = await getSessionInfo()
  if (!user || !isAdmin) redirect('/login')

  const params = await searchParams
  const selectedCustomerId = params.customer || null
  const statusFilter = params.status || null
  const openUnitId = params.open || null

  const { data: customers } = await supabase.from('customers').select('*').order('name')
  const defaultTaxRatePercent = await getDefaultTaxRatePercent(supabase)
  const { data: instantSignupSetting } = await supabase
    .from('shop_settings')
    .select('value')
    .eq('key', 'instant_signup_token')
    .maybeSingle()
  const instantSignupToken = instantSignupSetting?.value || ''
  const { data: referralSources } = await supabase.from('referral_sources').select('*').order('name')
  const { data: allUnits } = await supabase.from('units').select('*').order('created_at', { ascending: false })
  const { data: modelPartsAll } = await supabase.from('model_parts').select('*')
  const { data: unitOverridesAll } = await supabase.from('unit_part_overrides').select('*')
  const { data: orderSheetItemsAll } = await supabase.from('order_sheet_items').select('*').order('created_at')
  const { data: serviceHistoryAll } = await supabase
    .from('service_history')
    .select('*')
    .order('service_date', { ascending: false })
    .order('created_at', { ascending: false })
  const { data: unitPhotosAll } = await supabase
    .from('unit_photos')
    .select('*')
    .order('created_at', { ascending: true })
  const { data: unitMessagesAll } = await supabase
    .from('messages')
    .select('*')
    .not('unit_id', 'is', null)
    .order('created_at', { ascending: true })
  // For the "Edit Invoice" tool in each unit's panel - only unit-linked
  // invoices are relevant here (a standalone/custom invoice has no unit_id
  // and isn't editable from this page). Ordered newest-first so the map
  // below keeps only the most recent invoice per unit - the one the "View
  // current invoice/quote" link and units.invoice_url already point at.
  const { data: unitInvoicesAll } = await supabase
    .from('invoices')
    .select('id, unit_id, invoice_number, line_items, amount, sales_tax_rate, card_surcharge_amount, labor_type, paid_at, square_payment_link_url, stripe_payment_link_url, notes')
    .not('unit_id', 'is', null)
    .order('created_at', { ascending: false })
  const latestInvoiceByUnit = new Map<string, NonNullable<typeof unitInvoicesAll>[number]>()
  for (const inv of unitInvoicesAll || []) {
    if (inv.unit_id && !latestInvoiceByUnit.has(inv.unit_id)) latestInvoiceByUnit.set(inv.unit_id, inv)
  }

  let units = allUnits
  if (selectedCustomerId && !statusFilter) {
    units = allUnits?.filter(u => u.customer_id === selectedCustomerId) || []
  }

  const received = allUnits?.filter(u => u.status === 'Received').length || 0
  const diagnosing = allUnits?.filter(u => u.status === 'Diagnosing').length || 0
  const needsApproval = allUnits?.filter(u => u.status === 'Needs Approval').length || 0
  const inRepair = allUnits?.filter(u => u.status === 'In Repair').length || 0
  const repairRequested = allUnits?.filter(u => u.status === 'Repair Requested').length || 0
  const readyPickup = allUnits?.filter(u => u.status === 'Ready for Pickup').length || 0
  const priorityCount = allUnits?.filter(u => u.is_priority).length || 0

  const fleetUnitsAll = (selectedCustomerId
    ? allUnits?.filter(u => u.customer_id === selectedCustomerId)
    : allUnits) || []
  const unitsCount = fleetUnitsAll.length

  const statusFilteredUnits = (() => {
    if (!statusFilter || !allUnits) return []
    let list = allUnits
    if (selectedCustomerId) {
      list = list.filter(u => u.customer_id === selectedCustomerId)
    }
    if (statusFilter === 'Priority') return list.filter(u => u.is_priority)
    if (statusFilter === 'Units') return list
    return list.filter(u => u.status === statusFilter)
  })()

  const currentCustomer = customers?.find(c => c.id === selectedCustomerId)
  const now = new Date()
  const isSnoozed = (u: any) => u.snoozed_until && new Date(u.snoozed_until) > now

  // "Stale" = sitting in the current status for 7+ days without a status
  // change (status_since), not just time since original check-in - a unit
  // that moved through several statuses quickly but is now stuck doesn't
  // get penalized for its overall age, and one that's been stuck since day
  // one looks the same either way.
  type StaleCheck = { status_since?: string | null; created_at: string; snoozed_until?: string | null }
  const daysInStatus = (u: StaleCheck) =>
    Math.floor((now.getTime() - new Date(u.status_since || u.created_at).getTime()) / (1000 * 60 * 60 * 24))
  const isStaleInStatus = (u: StaleCheck) => !isSnoozed(u) && daysInStatus(u) >= 7
  // Stable sort - stale units bump to the top, but keep their existing
  // (newest-check-in-first) relative order within each group.
  const sortStaleFirst = <T extends StaleCheck>(list: T[]) =>
    [...list].sort((a, b) => Number(isStaleInStatus(b)) - Number(isStaleInStatus(a)))

  const staleUnits = (units?.filter(u => {
    if (isSnoozed(u)) return false
    if (['Registered', 'Ready for Pickup', 'Fleet'].includes(u.status)) return false
    return daysInStatus(u) >= 7
  }) || []).map(u => ({
    ...u,
    daysSinceCheckIn: daysInStatus(u),
  }))

  const approvedDecisions = units?.filter(u => !u.decision_seen && u.notes?.includes('Approved by')) || []
  const deniedDecisions = units?.filter(u => !u.decision_seen && u.notes?.includes('Denied by')) || []
  const waitingOnCustomer = sortStaleFirst(units?.filter(u => u.status === 'Needs Approval' && !isSnoozed(u)) || [])
  const repairRequestedUnits = sortStaleFirst(units?.filter(u => u.status === 'Repair Requested' && !isSnoozed(u)) || [])
  const diagnosingUnits = sortStaleFirst(units?.filter(u => u.status === 'Diagnosing' && !isSnoozed(u)) || [])
  const readyForPickupUnits = sortStaleFirst(units?.filter(u => u.status === 'Ready for Pickup' && !isSnoozed(u)) || [])
  const priorityUnits = sortStaleFirst(units?.filter(u => u.is_priority && !isSnoozed(u)) || [])

  const customerFleet = selectedCustomerId
    ? (allUnits?.filter(u => u.customer_id === selectedCustomerId) || [])
    : []
  const sortedFleet = [...customerFleet].sort((a, b) => {
    const ga = equipmentGroup(a.equipment_type)
    const gb = equipmentGroup(b.equipment_type)
    if (ga !== gb) return ga - gb
    return (a.serial_number || '').localeCompare(b.serial_number || '')
  })

  // Equipment this customer has rented from Savage Chainsaws' own fleet -
  // distinct from the units above (which they own and bring in for
  // repair). See app/rentals/page.tsx for the full rental management flow.
  const { data: customerRentals } = selectedCustomerId
    ? await supabase
        .from('rentals')
        .select('id, rental_type, start_date, end_date, status, total_owed, paid_at, agreement_pdf_url, rental_units(model, equipment_type)')
        .eq('customer_id', selectedCustomerId)
        .order('created_at', { ascending: false })
    : { data: [] }

  const repairUnits = sortStaleFirst(units?.filter(u => u.status !== 'Fleet') || [])


  function ActionCard({ unit, borderColor, children }: { unit: any; borderColor: string; children?: React.ReactNode }) {
    return (
      <div className={`px-4 sm:px-6 py-3 hover:bg-zinc-800/40 transition border-l-4 ${borderColor}`}>
        <div className="flex items-start gap-3">
          <Link href={`/?customer=${unit.customer_id}&open=${unit.id}`} className="flex gap-3 sm:gap-4 flex-1 min-w-0">
            <UnitPhoto unit={unit} size="h-14 w-14 sm:h-24 sm:w-24" emptyContent="No photo" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-base sm:text-xl font-semibold truncate">{unitLabel(unit)}</p>
                {unit.is_priority && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-orange-500 text-black">PRIORITY</span>
                )}
                {isStaleInStatus(unit) && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-red-600 text-white">
                    NEEDS ATTENTION - {daysInStatus(unit)}d
                  </span>
                )}
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                  unit.status === 'Needs Approval' || unit.status === 'Repair Requested' ? 'bg-yellow-500/20 text-yellow-400'
                    : unit.status === 'Ready for Pickup' ? 'bg-green-500/20 text-green-400'
                    : unit.status === 'In Repair' ? 'bg-blue-500/20 text-blue-400'
                    : unit.status === 'Fleet' ? 'bg-zinc-600 text-gray-300'
                    : 'bg-orange-500/20 text-orange-400'
                }`}>{unit.status}</span>
              </div>
              <p className="text-sm text-gray-400">
                Serial: {unit.serial_number || '-'}
                {unit.nickname ? ` - ${unit.nickname}` : ''}
              </p>
              {children}
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500 mt-0.5">
                <span>Checked in: {formatDate(unit.created_at)}</span>
                {unit.hour_meter && <span>Hours: {unit.hour_meter}</span>}
              </div>
              <p className="text-xs text-orange-400 mt-2">Tap card to open unit {'->'}</p>
            </div>
          </Link>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <form action={snoozeUnit}>
              <input type="hidden" name="id" value={unit.id} />
              <input type="hidden" name="days" value="7" />
              <button type="submit" className="bg-zinc-700 hover:bg-zinc-600 text-white text-sm px-3 py-1.5 rounded-lg transition whitespace-nowrap">Delay 7 Days</button>
            </form>
            {(approvedDecisions.some(d => d.id === unit.id) || deniedDecisions.some(d => d.id === unit.id)) && (
              <form action={markDecisionSeen}>
                <input type="hidden" name="id" value={unit.id} />
                <button type="submit" className="bg-zinc-600 hover:bg-zinc-500 text-white text-sm px-3 py-1.5 rounded-lg transition whitespace-nowrap">Mark Seen</button>
              </form>
            )}
            <DeleteUnitButton id={unit.id} />
          </div>
        </div>
        <details className="mt-2 group/notes ml-[calc(3.5rem+0.75rem)] sm:ml-[calc(6rem+1rem)]">
          <summary className="text-xs text-orange-400 hover:text-orange-300 cursor-pointer list-none select-none">
            Notes {unit.notes ? `- has notes${unit.notes_updated_at ? ` (updated ${formatShortDate(unit.notes_updated_at)})` : ''}` : ''}
          </summary>
          <NotesForm unitId={unit.id} initialNotes={unit.notes || ''} action={updateNotes} />
        </details>
      </div>
    )
  }

  function UnitPartsSection({ unit }: { unit: any }) {
    const parts = resolveUnitParts(unit, modelPartsAll || [], unitOverridesAll || [])
    return (
      <details className="mt-3 border-t border-zinc-800 pt-2.5 group/parts-panel">
        <summary className="flex items-center justify-between cursor-pointer list-none select-none mb-2">
          <span className="text-xs text-gray-500 uppercase tracking-wider">
            Parts &amp; SKUs (admin only){parts.length > 0 ? ` (${parts.length})` : ''}
          </span>
          <span className="text-gray-500 text-xs group-open/parts-panel:rotate-180 transition">v</span>
        </summary>
        {parts.length === 0 ? (
          <div className="mb-2 space-y-1.5">
            <p className="text-xs text-gray-500">No default parts set for this model yet.</p>
            <Link href="/parts" className="inline-block text-xs bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded-lg">
              Add one in the Parts Catalog
            </Link>
          </div>
        ) : (
          <div className="space-y-1.5 mb-2">
            {parts.map(p => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-gray-300 w-28 shrink-0">{p.part_name}</span>
                <span className="font-mono text-orange-300">{p.sku}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  p.sku_type === 'Aftermarket' ? 'bg-purple-500/20 text-purple-400' : 'bg-zinc-700 text-gray-300'
                }`}>
                  {p.sku_type}
                </span>
                {p.isOverride ? (
                  <>
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-500/20 text-blue-400">
                      {p.hasDefault ? 'Overridden' : 'Unit-only'}
                    </span>
                    <form action={deleteUnitPartOverride}>
                      <input type="hidden" name="id" value={p.id} />
                      <button type="submit" className="text-xs text-red-400 hover:text-red-300">
                        {p.hasDefault ? 'Reset to default' : 'Remove'}
                      </button>
                    </form>
                  </>
                ) : (
                  <span className="text-xs text-gray-600">Model default</span>
                )}
              </div>
            ))}
          </div>
        )}
        <details className="group/parts">
          <summary className="inline-flex w-fit text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-orange-400 px-3 py-1.5 rounded-lg cursor-pointer list-none select-none">
            Override or add a part for this unit
          </summary>
          <form action={upsertUnitPartOverride} className="mt-2 flex flex-wrap gap-2">
            <input type="hidden" name="unit_id" value={unit.id} />
            <input type="hidden" name="unit_model" value={unit.model || ''} />
            <input
              name="part_name"
              list={`parts-${unit.id}`}
              placeholder="Part name (e.g. Blade)"
              className="flex-1 min-w-[140px] bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
            />
            <datalist id={`parts-${unit.id}`}>
              {parts.map(p => <option key={p.id} value={p.part_name} />)}
            </datalist>
            <UppercaseInput
              name="sku"
              placeholder="SKU"
              className="flex-1 min-w-[140px] font-mono bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
            />
            <select
              name="sku_type"
              defaultValue="OEM"
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
            >
              <option value="OEM">OEM (sets default for this model)</option>
              <option value="Aftermarket">Aftermarket (this unit only)</option>
            </select>
            <button type="submit" className="text-xs bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded-lg">
              Save
            </button>
          </form>
        </details>
      </details>
    )
  }

  // Order Sheet - see addOrderSheetItem above for the full rationale.
  // Paste a SKU from STIHL's dealer parts catalog, it auto-fills from
  // parts_catalog (real distributor pricing), and the running list can be
  // printed via /order-sheet/[unitId] to take to the store.
  function UnitOrderSheetSection({ unit }: { unit: any }) {
    const items = (orderSheetItemsAll || []).filter(i => i.unit_id === unit.id)
    const totalRetail = items.reduce((sum, i) => sum + (Number(i.retail_price) || 0) * i.quantity, 0)
    return (
      <details className="mt-3 border-t border-zinc-800 pt-2.5 group/order-sheet-panel">
        <summary className="inline-flex items-center gap-1.5 cursor-pointer list-none select-none bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-1.5 rounded-lg mb-2">
          Order Sheet{items.length > 0 ? ` (${items.length})` : ''}
          <span className="text-xs group-open/order-sheet-panel:rotate-180 transition">v</span>
        </summary>
        {items.length === 0 ? (
          <p className="text-xs text-gray-500 mb-2">No parts added yet - paste a SKU below as you diagnose.</p>
        ) : (
          <div className="space-y-1.5 mb-2">
            {items.map(i => (
              <div key={i.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-orange-300">{i.sku}</span>
                <span className="text-gray-300 flex-1 min-w-[120px]">{i.description}</span>
                <form action={updateOrderSheetItemQuantity} className="flex items-center gap-1">
                  <input type="hidden" name="id" value={i.id} />
                  <label className="text-xs text-gray-500">Qty</label>
                  <input
                    name="quantity"
                    type="number"
                    min={1}
                    defaultValue={i.quantity}
                    className="w-14 bg-zinc-800 border border-zinc-700 rounded-lg px-1.5 py-0.5 text-xs"
                  />
                  <button type="submit" className="text-xs text-orange-400 hover:text-orange-300">Save</button>
                </form>
                <span className="text-xs text-gray-400 w-16 text-right">
                  {i.retail_price != null ? `$${Number(i.retail_price).toFixed(2)}` : '-'}
                </span>
                <form action={deleteOrderSheetItem}>
                  <input type="hidden" name="id" value={i.id} />
                  <button type="submit" className="text-xs text-red-400 hover:text-red-300">Remove</button>
                </form>
              </div>
            ))}
            <p className="text-xs text-gray-500 pt-1">Estimated retail total: ${totalRetail.toFixed(2)}</p>
          </div>
        )}
        {/* key={items.length} forces a remount after each successful Add, so
            the uncontrolled SKU/quantity inputs reset to empty - otherwise
            React reconciles the same DOM nodes across the revalidatePath
            re-render and leaves the typed SKU sitting in the field. */}
        <form key={items.length} action={addOrderSheetItem} className="flex flex-wrap gap-2 mb-2">
          <input type="hidden" name="unit_id" value={unit.id} />
          <UppercaseInput
            name="sku"
            placeholder="Paste SKU from Steele's/STIHL catalog"
            className="flex-1 min-w-[160px] font-mono bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
          />
          <input
            name="quantity"
            type="number"
            min={1}
            defaultValue={1}
            className="w-16 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm"
          />
          <button type="submit" className="text-xs bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded-lg">
            Add
          </button>
        </form>
        {items.length > 0 && (
          // Jumps to CreateInvoiceSection's <details> below (see its
          // matching id) - browsers auto-expand a closed <details> you link
          // to (the HTML "reveal" algorithm), so this needs no client JS to
          // both open it and scroll it into view, already pre-filled with
          // these same Order Sheet parts at retail price.
          <a
            href={`#create-invoice-${unit.id}`}
            className="inline-flex items-center gap-1.5 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-1.5 rounded-lg mb-2"
          >
            Generate Invoice from Order Sheet {'->'}
          </a>
        )}
        <div className="flex gap-3">
          {items.length > 0 && (
            <Link
              href={`/order-sheet/${unit.id}`}
              target="_blank"
              className="text-xs text-orange-400 hover:text-orange-300"
            >
              Print Order Sheet {'->'}
            </Link>
          )}
          {items.length > 0 && (
            <form action={clearOrderSheet}>
              <input type="hidden" name="unit_id" value={unit.id} />
              <button type="submit" className="text-xs text-gray-500 hover:text-red-400">Clear list</button>
            </form>
          )}
        </div>
      </details>
    )
  }

  function UnitPhotosSection({ unit }: { unit: any }) {
    const extraPhotos = (unitPhotosAll || []).filter(p => p.unit_id === unit.id && p.stage === 'checkin')
    const photos = [
      ...(unit.photo_url ? [{ id: 'checkin', url: unit.photo_url as string, caption: 'Check-in photo', deletable: false }] : []),
      ...extraPhotos.map(p => ({ id: p.id as string, url: p.url as string, caption: p.caption as string | null })),
    ]
    return (
      <details className="mt-3 border-t border-zinc-800 pt-2.5 group/photos-panel">
        <summary className="flex items-center justify-between cursor-pointer list-none select-none mb-2">
          <span className="text-xs text-gray-500 uppercase tracking-wider">
            Photos{photos.length > 0 ? ` (${photos.length})` : ''}
          </span>
          <span className="text-gray-500 text-xs group-open/photos-panel:rotate-180 transition">v</span>
        </summary>
        <div className="space-y-2">
          {photos.length === 0 ? (
            <p className="text-xs text-gray-500">No photos yet.</p>
          ) : (
            <UnitPhotoGallery photos={photos} onDelete={deleteUnitPhoto} />
          )}
          <UnitPhotoUpload unitId={unit.id} action={addUnitPhoto} />
        </div>
      </details>
    )
  }

  // Diagnosis Findings - a section deliberately separate from Photos above:
  // its own heading, own upload control (multi-select, photos and videos),
  // own storage tag (stage: 'diagnosis'). Never mixes with the check-in
  // gallery. Visible to the customer too (see the matching block in
  // app/customer/page.tsx), right alongside Diagnosis Notes.
  function DiagnosisFindingsSection({ unit }: { unit: { id: string } }) {
    const media = (unitPhotosAll || []).filter(p => p.unit_id === unit.id && p.stage === 'diagnosis')
    return (
      <details className="mt-3 group/diagnosis-media-panel" open={media.length > 0}>
        {/* Deliberately loud - this used to be an easy-to-miss plain-text
            caption. A highlighted, bordered box makes it impossible to
            scroll past without noticing there's media attached. */}
        <summary className="flex items-center justify-between gap-2 cursor-pointer list-none select-none bg-orange-500/15 border border-orange-500/40 rounded-lg px-3 py-2.5 hover:bg-orange-500/20 transition">
          <span className="flex items-center gap-2 text-sm font-bold text-orange-300 uppercase tracking-wide">
            Diagnosis Findings - Photos &amp; Videos
            {media.length > 0 && (
              <span className="text-xs bg-orange-500 text-black font-bold rounded-full px-2 py-0.5">{media.length}</span>
            )}
          </span>
          <span className="text-orange-400 text-xs group-open/diagnosis-media-panel:rotate-180 transition">v</span>
        </summary>
        <div className="space-y-2 mt-2">
          {media.length === 0 ? (
            <p className="text-xs text-gray-500">No diagnosis photos/videos yet.</p>
          ) : (
            <UnitPhotoGallery
              photos={media.map(p => ({ id: p.id as string, url: p.url as string, caption: p.caption as string | null, mediaType: p.media_type as 'photo' | 'video' }))}
              onDelete={deleteUnitPhoto}
            />
          )}
          <DiagnosisMediaUpload unitId={unit.id} action={addDiagnosisMedia} />
        </div>
      </details>
    )
  }

  // Pairs the earliest check-in photo with the most recent diagnosis photo
  // on file so drop-off vs. pickup condition is visible at a glance -
  // renders nothing (via BeforeAfterCompare's own guard) unless both a
  // check-in and a diagnosis photo actually exist for this unit. Works
  // retroactively on any unit's existing photos, not just future check-ins.
  function BeforeAfterCompareSection({ unit }: { unit: { id: string; photo_url: string | null; created_at: string } }) {
    const beforePhotos = [
      ...(unit.photo_url ? [{ id: 'checkin-primary', url: unit.photo_url as string, label: formatShortDate(unit.created_at) }] : []),
      ...(unitPhotosAll || [])
        .filter(p => p.unit_id === unit.id && p.stage === 'checkin')
        .map(p => ({ id: p.id as string, url: p.url as string, label: p.caption || formatShortDate(p.created_at) })),
    ]
    const afterPhotos = (unitPhotosAll || [])
      .filter(p => p.unit_id === unit.id && p.stage === 'diagnosis' && p.media_type !== 'video')
      .map(p => ({ id: p.id as string, url: p.url as string, label: p.caption || formatShortDate(p.created_at) }))
    return <BeforeAfterCompare beforePhotos={beforePhotos} afterPhotos={afterPhotos} />
  }

  // Replaces the old raw unit.history timestamp log - a quick "this unit
  // was last in for X" reference instead. service_history rows are only
  // created when a unit reaches Ready for Pickup, so the most recent entry
  // is naturally the most recent *prior* completed visit, never the one
  // in progress. Shows nothing if the unit has never completed a visit.
  function MostRecentServiceHistorySection({ unit }: { unit: { id: string } }) {
    const latest = (serviceHistoryAll || [])
      .filter(e => e.unit_id === unit.id)[0]
    if (!latest) return null
    return (
      <div className="mt-3 border-t border-zinc-800 pt-2.5">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Most Recent Service History</p>
        <p className="text-xs text-gray-500">{formatShortDate(latest.service_date)}</p>
        <p className="text-sm text-gray-300 whitespace-pre-wrap">{latest.description}</p>
      </div>
    )
  }

  function ServiceHistorySection({ unit }: { unit: any }) {
    const entries = (serviceHistoryAll || []).filter(e => e.unit_id === unit.id)
    return (
      <details className="mt-3 border-t border-zinc-800 pt-2.5 group/history-panel">
        <summary className="flex items-center justify-between cursor-pointer list-none select-none mb-2">
          <span className="text-xs text-gray-500 uppercase tracking-wider">
            Service History{entries.length > 0 ? ` (${entries.length})` : ''}
          </span>
          <span className="text-gray-500 text-xs group-open/history-panel:rotate-180 transition">v</span>
        </summary>
        {entries.length === 0 ? (
          <p className="text-xs text-gray-500 mb-2">
            No service history yet. Entries are logged automatically when a unit is marked Ready for Pickup.
          </p>
        ) : (
          <div className="space-y-1.5 mb-2">
            {entries.map(e => (
              <div key={e.id} className="flex flex-wrap items-start gap-2 text-sm">
                <span className="text-gray-500 w-24 shrink-0">{formatShortDate(e.service_date)}</span>
                <span className="text-gray-300 flex-1 min-w-[140px]">{e.description}</span>
                <span className="font-mono text-orange-300">{e.cost != null ? `$${Number(e.cost).toFixed(2)}` : '-'}</span>
                <form action={deleteServiceHistoryEntry}>
                  <input type="hidden" name="id" value={e.id} />
                  <button type="submit" className="text-xs text-red-400 hover:text-red-300">Remove</button>
                </form>
              </div>
            ))}
          </div>
        )}
        <details className="group/service-history">
          <summary className="inline-flex w-fit text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-orange-400 px-3 py-1.5 rounded-lg cursor-pointer list-none select-none">
            Add a service history entry
          </summary>
          <form action={addServiceHistoryEntry} className="mt-2 flex flex-wrap gap-2">
            <input type="hidden" name="unit_id" value={unit.id} />
            <input
              name="service_date"
              type="date"
              defaultValue={new Date().toISOString().split('T')[0]}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
            />
            <TitleCaseInput
              name="description"
              placeholder="Work performed"
              className="flex-1 min-w-[140px] bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
            />
            <input
              name="cost"
              type="number"
              step="0.01"
              min="0"
              placeholder="Cost $"
              className="w-28 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
            />
            <button type="submit" className="text-xs bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded-lg">
              Save
            </button>
          </form>
        </details>
      </details>
    )
  }

  // Admin-only. Generates a PDF invoice on demand via /api/invoice - line
  // items are entered fresh each time (not stored), since not every job is
  // billed the same. The first labor line defaults its price to the unit's
  // most recent logged service cost as a starting point, left fully
  // editable; parts have no price data to draw from (Parts & SKUs tracks
  // name/SKU/OEM-Aftermarket only, no pricing) so they're always blank.
  function CreateInvoiceSection({ unit }: { unit: any }) {
    const unitCustomer = (customers || []).find(c => c.id === unit.customer_id)
    const parts = resolveUnitParts(unit, modelPartsAll || [], unitOverridesAll || [])
    const history = (serviceHistoryAll || []).filter(e => e.unit_id === unit.id)
    const latestCost = history[0]?.cost ?? ''
    const orderSheetItems = (orderSheetItemsAll || []).filter(i => i.unit_id === unit.id)
    // Retail price is what the customer pays - cost stays Order-Sheet-only,
    // for Jesse's own reference when he's at the store buying the parts.
    const defaultPartsItems = orderSheetItems.map(i => ({
      description: `${i.description} (${i.sku})`,
      price: (Number(i.retail_price) || 0).toFixed(2),
      quantity: String(i.quantity),
    }))
    return (
      <details className="group/invoice-panel">
        <summary className="inline-flex items-center gap-1.5 cursor-pointer list-none select-none bg-orange-600 hover:bg-orange-500 text-white text-sm px-4 py-1.5 rounded-lg">
          Create Invoice
          <span className="text-xs group-open/invoice-panel:rotate-180 transition">v</span>
        </summary>
        {/* id lives on this inner, closed-by-default div (not the <details>
            itself) - a <details>'s own visibility never depends on its open
            state (the summary always shows), so a fragment link targeting
            the <details> tag directly doesn't qualify for the browser's
            auto-open-closed-ancestor-details behavior and just scrolls to
            the still-collapsed header. Targeting genuinely hidden content
            instead makes the browser open this <details> for us - see the
            "Generate Invoice from Order Sheet" link in
            UnitOrderSheetSection above. */}
        <div id={`create-invoice-${unit.id}`} className="w-full mt-2">
          <CreateUnitInvoiceForm
            unitId={unit.id}
            defaultLaborPrice={latestCost}
            defaultPriorityFee={unit.is_priority ? PRIORITY_FEE : ''}
            defaultTaxRatePercent={defaultTaxRatePercent}
            defaultPartsItems={defaultPartsItems}
            customerPaymentPlansEnabled={!!unitCustomer?.payment_plans_enabled}
          />
          <p className="text-xs text-gray-600 mt-1.5">
            {orderSheetItems.length > 0
              ? `${orderSheetItems.length} part${orderSheetItems.length === 1 ? '' : 's'} loaded from the Order Sheet at retail price - just add labor below.`
              : parts.length > 0
              ? `${parts.length} part${parts.length === 1 ? '' : 's'} on file for this model - add them to Parts above if used on this job.`
              : 'No parts on file for this unit - the invoice will still generate.'}
          </p>
        </div>
      </details>
    )
  }

  // Lets Jesse handle a mid-service change request (customer calls asking
  // for a chain added, a part removed, a price corrected) against the
  // unit's most recent invoice without creating a whole new one - reopens
  // that invoice's Parts/Labor lines, recalculates tax + surcharge off the
  // edited subtotal on save, and regenerates the same invoice/PDF in
  // place. Only rendered when a real invoices row exists for this unit
  // (see latestInvoiceByUnit above) - a unit whose only "invoice" is a
  // manually uploaded photo/PDF (see updateStatus's invoice-upload field)
  // has no row to edit here.
  function EditInvoiceSection({ unit }: { unit: any }) {
    const invoice = latestInvoiceByUnit.get(unit.id)
    if (!invoice) return null
    const parsed = parseInvoiceLineItemsForEdit(invoice.line_items)
    const hasParts = parsed.partsItems.some((it: { description: string }) => it.description.trim().length > 0)
    return (
      <details className="group/edit-invoice">
        <summary className="inline-flex items-center gap-1.5 cursor-pointer list-none select-none bg-zinc-700 hover:bg-zinc-600 text-white text-sm px-4 py-1.5 rounded-lg whitespace-nowrap">
          Edit Invoice {invoice.invoice_number}
          <span className="text-xs group-open/edit-invoice:rotate-180 transition">v</span>
        </summary>
        <div className="w-full mt-2 space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500">Current total:</span>
            <span className="font-bold text-orange-400">${Number(invoice.amount).toFixed(2)}</span>
            {invoice.paid_at ? (
              <span className="px-1.5 py-0.5 rounded-full font-medium bg-green-500/20 text-green-400">
                Already Paid - editing still allowed, but double-check with the customer first
              </span>
            ) : (invoice.square_payment_link_url || invoice.stripe_payment_link_url) ? (
              <span className="px-1.5 py-0.5 rounded-full font-medium bg-yellow-500/20 text-yellow-400">
                Has a Payment Link - saving will clear it so a fresh one matches the new total
              </span>
            ) : null}
          </div>
          <EditInvoiceForm
            invoiceId={invoice.id}
            hasUnitId
            customers={[]}
            initialCustomerId={null}
            initialCustomerName={currentCustomer?.name || ''}
            initialCustomerEmail={currentCustomer?.email || ''}
            initialPartsItems={parsed.partsItems}
            initialLaborItems={parsed.laborItems}
            initialPriorityFee={parsed.priorityFee}
            initialReferralDiscountAmount={parsed.referralDiscountAmount}
            initialNotes={invoice.notes || ''}
            taxRatePercent={invoice.sales_tax_rate ?? defaultTaxRatePercent}
            includeCardSurcharge={Number(invoice.card_surcharge_amount) > 0}
            laborType={(invoice.labor_type as 'STLA' | 'NTSTLA') || (hasParts ? 'STLA' : 'NTSTLA')}
          />
        </div>
      </details>
    )
  }

  // The messages thread for this unit (customer questions and admin
  // replies, distinguished by is_admin) plus a small form to send a new
  // admin reply - previously read-only from the admin side.
  type UnitReply = { id: string; customer_name: string | null; is_admin: boolean; created_at: string; message: string }
  function UnitReplies({ unitId, messages }: { unitId: string; messages: UnitReply[] }) {
    return (
      <div className="mt-3 border-t border-zinc-800 pt-2.5">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Messages</p>
        {messages.length > 0 && (
          <div className="space-y-2 mb-2">
            {messages.map(m => (
              <div
                key={m.id}
                className={`border rounded-lg px-3 py-2 ${
                  m.is_admin ? 'bg-orange-500/10 border-orange-500/30' : 'bg-zinc-800/60 border-zinc-700'
                }`}
              >
                <p className="text-xs text-gray-500">
                  {m.is_admin ? 'Savage Chainsaws' : m.customer_name || 'Customer'} -{' '}
                  {new Date(m.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </p>
                <p className="text-sm text-gray-200 whitespace-pre-wrap mt-0.5">{m.message}</p>
              </div>
            ))}
          </div>
        )}
        <form action={replyToMessage} className="flex flex-col sm:flex-row gap-2">
          <input type="hidden" name="unit_id" value={unitId} />
          <input
            name="message"
            placeholder="Reply to the customer..."
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
          <button type="submit" className="bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-medium px-4 py-2 rounded-lg shrink-0">
            Reply
          </button>
        </form>
      </div>
    )
  }

  // The full editable unit panel - status dropdown, priority/fee/cost,
  // notes, invoice upload, withdraw/pickup, nudge, history, photos, parts,
  // service history. Shared between the per-customer "All Units - Repair
  // Flow" list and the cross-customer status-queue view (clicking a status
  // stat tile) so an edit made from either place hits the same
  // updateStatus/etc. server actions against the same row - single source
  // of truth, no separate copy. accordionName scopes the native exclusive-
  // accordion group (via <details name>) so expanding one unit in a list
  // auto-collapses the others in that same list without affecting the
  // other list.
  // Read-only lookup of the customer's own contact info (phone/email/
  // secondary email) from their existing customer record - nothing here
  // is unit-specific, it's just surfaced from the action row so admin
  // doesn't have to leave this panel to find a number to call.
  function CustomerInfoSection({
    customer,
  }: {
    customer: { name: string; phone: string | null; email: string | null; secondary_email: string | null } | null
  }) {
    if (!customer) return null
    const fields: { label: string; href: string; value: string }[] = []
    if (customer.phone) fields.push({ label: 'Phone', href: `tel:${customer.phone}`, value: customer.phone })
    if (customer.email) fields.push({ label: 'Email', href: `mailto:${customer.email}`, value: customer.email })
    if (customer.secondary_email) {
      fields.push({ label: 'Secondary Email', href: `mailto:${customer.secondary_email}`, value: customer.secondary_email })
    }
    if (fields.length === 0) return null
    return (
      <details className="group/customer-info ml-auto">
        <summary className="inline-flex items-center gap-1.5 cursor-pointer list-none select-none bg-zinc-700 hover:bg-zinc-600 text-white text-sm px-4 py-1.5 rounded-lg whitespace-nowrap">
          Customer Info
          <span className="text-xs group-open/customer-info:rotate-180 transition">v</span>
        </summary>
        <div className="w-full mt-2 bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-2.5 space-y-1.5">
          <p className="text-sm font-medium text-white">{customer.name}</p>
          {fields.map(f => (
            <p key={f.label} className="text-xs text-gray-400">
              <span className="text-gray-500">{f.label}: </span>
              <a href={f.href} className="text-orange-400 hover:text-orange-300 underline">{f.value}</a>
            </p>
          ))}
        </div>
      </details>
    )
  }

  function UnitDetailPanel({ unit, accordionName }: { unit: any; accordionName: string }) {
    const unitCustomer = customers?.find(c => c.id === unit.customer_id) || null
    return (
      <details
        name={accordionName}
        className="group/item border-2 border-transparent open:border-orange-500 open:bg-zinc-800/30 open:rounded-lg open:my-1 open:order-[-1] transition-colors"
        open={openUnitId === unit.id}
        id={`unit-${unit.id}`}
      >
        <UnitIdentityProvider
          formId={`unit-identity-form-${unit.id}`}
          key={unit.id + (unit.model || '') + (unit.equipment_type || '') + (unit.serial_number || '') + (unit.warranty_end || '')}
        >
          <summary className="px-4 sm:px-6 py-2.5 cursor-pointer hover:bg-zinc-800/50 transition flex items-center gap-3 flex-wrap">
            <UnitPhoto unit={unit} size="h-12 w-12" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <UnitDescriptionField unit={unit} label={unitLabel(unit)} />
                {unit.is_priority && <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-orange-500 text-black">PRIORITY</span>}
                {isStaleInStatus(unit) && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-red-600 text-white">
                    NEEDS ATTENTION - {daysInStatus(unit)}d
                  </span>
                )}
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                  unit.status === 'Needs Approval' || unit.status === 'Repair Requested' ? 'bg-yellow-500/20 text-yellow-400'
                    : unit.status === 'Ready for Pickup' ? 'bg-green-500/20 text-green-400'
                    : unit.status === 'In Repair' ? 'bg-blue-500/20 text-blue-400'
                    : 'bg-orange-500/20 text-orange-400'
                }`}>{unit.status}</span>
              </div>
              {unit.nickname && <p className="text-xs text-gray-500">{unit.nickname}</p>}
            </div>
            <UnitIdentityBox unit={unit} action={updateUnitIdentity} />
            <WarrantyBox unit={unit} action={updateUnitWarranty} key={unit.id + (unit.warranty_end || '')} />
          </summary>
        </UnitIdentityProvider>
        <div className="px-4 sm:px-6 pb-4">
          {/* The status <select>, Diagnosis Notes textarea, Customer Notes
              textarea and the invoice-upload file input all submit
              together via updateStatus, but no longer sit inside one
              physically contiguous <form> - Photos needs to land between
              Customer Notes and the Diagnosis Notes area, and Mark as
              Picked Up / Create Invoice / Nudge Customer need to live in
              the action row without nesting their own forms inside this
              one. Every such field instead carries form={formId} and
              associates by id regardless of where it renders - valid
              HTML5, and the only way to keep one atomic "Update" submit
              while satisfying the requested layout. StatusSelect and
              DiagnosisNotesField share reactive `status` via
              UnitStatusProvider rather than a DOM-id portal, so there's
              nothing here that depends on document/DOM timing during
              hydration. */}
          {(() => {
            const formId = `unit-status-form-${unit.id}`
            return (
              <UnitStatusProvider initialStatus={unit.status} key={unit.id + unit.status + unit.diagnosis_notes}>
                <div className="flex flex-wrap items-center gap-3">
                  <form id={formId} action={updateStatus} className="hidden">
                    <input type="hidden" name="id" value={unit.id} />
                  </form>

                  <StatusSelect formId={formId} />

                  {unit.status === 'Ready for Pickup' && (
                    <details className="group/pickup">
                      <summary className="inline-flex items-center gap-1.5 cursor-pointer list-none select-none bg-green-600 hover:bg-green-500 text-white text-sm px-4 py-1.5 rounded-lg">
                        Mark as Picked Up
                        <span className="text-xs group-open/pickup:rotate-180 transition">v</span>
                      </summary>
                      <div className="w-full mt-2">
                        <form action={markPickedUp} className="flex flex-wrap gap-2">
                          <input type="hidden" name="id" value={unit.id} />
                          <TitleCaseInput
                            name="picked_up_by"
                            required
                            placeholder="Name of person picking up"
                            className="flex-1 min-w-[180px] bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm"
                          />
                          <button type="submit" className="bg-green-600 hover:bg-green-500 text-white text-sm px-4 py-1.5 rounded-lg">
                            Confirm Picked Up
                          </button>
                        </form>
                      </div>
                    </details>
                  )}

                  <CreateInvoiceSection unit={unit} />

                  <form action={nudgeUnit}>
                    <input type="hidden" name="id" value={unit.id} />
                    <button type="submit" className="bg-purple-600 hover:bg-purple-500 text-white text-sm px-4 py-1.5 rounded-lg" title="Emails the customer a quick reminder about this unit">
                      Nudge Customer
                    </button>
                  </form>

                  <PriorityCheckbox formId={formId} defaultChecked={!!unit.is_priority} fee={PRIORITY_FEE} />
                  <button type="submit" form={formId} className="bg-orange-600 hover:bg-orange-500 text-white text-sm px-4 py-1.5 rounded-lg">Update</button>
                  <DeleteUnitButton id={unit.id} />
                  <CustomerInfoSection customer={unitCustomer} />
                </div>

                <div className="mt-3">
                  <label className="block text-xs font-bold text-gray-400 mb-1">Unit Photo</label>
                  <ThumbnailForm unitId={unit.id} action={updateThumbnail} />
                </div>

                {unit.problem_type && (
                  <p className="text-xs text-gray-400 mt-3">
                    <span className="text-gray-500">Problem reported: </span>{unit.problem_type}
                  </p>
                )}

                <div className="mt-3">
                  <div className="flex items-center gap-2 mb-1">
                    <label className="block text-xs font-bold text-blue-300">Customer Notes</label>
                    {unit.notes_updated_at && (
                      <span className="text-xs text-blue-400 bg-blue-500/10 border border-blue-500/30 rounded-full px-2 py-0.5">
                        Updated {new Date(unit.notes_updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-600 mb-1">What the customer reported at check-in.</p>
                  <textarea
                    form={formId}
                    name="notes"
                    defaultValue={unit.notes || ''}
                    rows={2}
                    placeholder="Customer notes..."
                    className="w-full bg-zinc-900 border border-blue-500/40 rounded-lg px-3 py-2 text-sm text-blue-100"
                  />
                </div>

                <UnitPhotosSection unit={unit} />

                {/* Everything to do with diagnosing this unit - Diagnosis
                    Notes, the quote/estimate link, Parts & SKUs, and
                    Diagnosis Findings media - grouped into one bordered
                    block. Mirrors the customer-facing grouping in
                    app/customer/page.tsx. */}
                <div className="border border-orange-500/30 rounded-xl p-3 sm:p-4 bg-orange-500/[0.03] space-y-3 mt-3">
                  <DiagnosisNotesField unit={unit} formId={formId} />
                  {(unit.status === 'Needs Approval' || unit.status === 'Ready for Pickup') && (
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">{unit.status === 'Needs Approval' ? 'Upload Invoice / Photo' : 'Upload Photo'}</label>
                      <input form={formId} type="file" name="invoice" accept="image/*,.pdf" className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-orange-600 file:text-white" />
                    </div>
                  )}
                  {unit.invoice_url && (
                    <a href={unit.invoice_url} target="_blank" rel="noreferrer" className="text-xs text-orange-400 hover:text-orange-300">View current invoice/quote {'->'}</a>
                  )}
                  <EditInvoiceSection unit={unit} />
                  <DiagnosisFindingsSection unit={unit} />
                  <BeforeAfterCompareSection unit={unit} />
                  <UnitPartsSection unit={unit} />
                  <UnitOrderSheetSection unit={unit} />
                </div>
              </UnitStatusProvider>
            )
          })()}

          <UnitReplies unitId={unit.id} messages={unitMessagesAll?.filter(m => m.unit_id === unit.id) || []} />

          {(unit.status === 'Repair Requested' || unit.status === 'Received' || unit.status === 'Diagnosing' || unit.status === 'Registered') && (
            <form action={returnToFleet} className="pt-3">
              <input type="hidden" name="id" value={unit.id} />
              <button type="submit" className="bg-zinc-700 hover:bg-zinc-600 text-white text-sm px-4 py-1.5 rounded-lg">
                Withdraw {'->'} Return to Fleet
              </button>
            </form>
          )}

          {unit.picked_up_by && (
            <p className="text-xs text-gray-500 pt-3">
              Picked up by <span className="text-gray-300">{unit.picked_up_by}</span> on {formatDate(unit.picked_up_at)}
            </p>
          )}

          <MostRecentServiceHistorySection unit={unit} />
          <ServiceHistorySection unit={unit} />
        </div>
      </details>
    )
  }

  // Falls back to the Savage Chainsaws brand orange for any customer who
  // hasn't set their own brand_color (paired with their logo on the
  // customer portal) - used to box off each customer's units on this page.
  const SAVAGE_BRAND_COLOR = '#ea580c'

  function groupUnitsByCustomer(unitList: any[]) {
    const groups = new Map<string, { customer: any; units: any[] }>()
    for (const unit of unitList) {
      const key = unit.customer_id || 'unknown'
      if (!groups.has(key)) {
        groups.set(key, { customer: customers?.find(c => c.id === unit.customer_id) || null, units: [] })
      }
      groups.get(key)!.units.push(unit)
    }
    return Array.from(groups.values()).sort((a, b) => {
      if (b.units.length !== a.units.length) return b.units.length - a.units.length
      return (a.customer?.name || 'Unknown').localeCompare(b.customer?.name || 'Unknown')
    })
  }

  function CustomerGroupHeader({ customer, count }: { customer: any; count: number }) {
    const accent = customer?.brand_color || SAVAGE_BRAND_COLOR
    return (
      <div
        className="flex items-center gap-3 px-4 sm:px-6 py-2.5 border-b"
        style={{ backgroundColor: hexToRgba(accent, 0.16), borderBottomColor: hexToRgba(accent, 0.4) }}
      >
        {customer?.logo_url ? (
          <img
            src={customer.logo_url}
            alt={customer.name}
            className="h-9 w-9 rounded-lg object-contain bg-zinc-900 border border-zinc-700 shrink-0"
          />
        ) : null}
        <h3 className="text-lg sm:text-xl font-bold text-white truncate">{customer?.name || 'Unknown Customer'}</h3>
        {customer?.referral_source_id && (
          <span
            title="Referred customer - premier welcome + first-service discount"
            className="shrink-0 flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40"
          >
            ★ Referred
          </span>
        )}
        <span className="text-xs text-gray-400 shrink-0 ml-auto">{count} unit{count !== 1 ? 's' : ''}</span>
      </div>
    )
  }

  function GroupedActionList({
    units: list,
    borderColor,
    renderExtra,
  }: {
    units: any[]
    borderColor: string
    renderExtra?: (unit: any) => React.ReactNode
  }) {
    return (
      <>
        {groupUnitsByCustomer(list).map(group => (
          <div
            key={group.customer?.id || 'unknown'}
            className="rounded-lg overflow-hidden"
            style={{ border: `2px solid ${group.customer?.brand_color || SAVAGE_BRAND_COLOR}` }}
          >
            <CustomerGroupHeader customer={group.customer} count={group.units.length} />
            <div className="divide-y divide-zinc-800/60">
              {group.units.map(unit => (
                <ActionCard key={unit.id} unit={unit} borderColor={borderColor}>
                  {renderExtra?.(unit)}
                </ActionCard>
              ))}
            </div>
          </div>
        ))}
      </>
    )
  }

  let lastGroup = 0

  const tiles = [
    { key: 'Repair Requested', label: 'Requested', count: repairRequested, color: 'text-blue-300' },
    { key: 'Received', label: 'Received', count: received, color: 'text-purple-400' },
    { key: 'Diagnosing', label: 'Diagnosing', count: diagnosing, color: 'text-orange-400' },
    { key: 'Needs Approval', label: 'Needs Approval', count: needsApproval, color: 'text-yellow-400' },
    { key: 'In Repair', label: 'In Repair', count: inRepair, color: 'text-blue-400' },
    { key: 'Ready for Pickup', label: 'Ready', count: readyPickup, color: 'text-green-300' },
    { key: 'Priority', label: 'Priority', count: priorityCount, color: 'text-orange-500' },
    { key: 'Units', label: 'All Units', count: unitsCount, color: 'text-orange-300' },
  ]

  return (
    <main className="min-h-screen bg-zinc-950 text-white p-4 sm:p-6 md:p-10">
      <Suspense fallback={null}><InactivityRedirect /></Suspense>
      <ScrollToOpenUnit unitId={openUnitId} />

      {/* Always visible, always on top - this is the "someone's standing in
          front of me right now" link, so it can't be buried behind a scroll
          or a collapsed accordion section (see the full admin panel further
          down for regenerating it). */}
      {instantSignupToken && (
        <div className="sticky top-0 z-50 -m-4 sm:-m-6 md:-m-10 mb-4 sm:mb-6 md:mb-10 px-4 sm:px-6 md:px-10 py-2.5 bg-zinc-900/95 backdrop-blur border-b border-orange-500/40">
          <div className="max-w-6xl mx-auto">
            <CopyInstantSignupLink token={instantSignupToken} variant="button" />
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4 md:mb-6 bg-zinc-900 border border-zinc-800 rounded-xl p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <img src="/images/logo.png" alt="Savage Chainsaws" className="h-12 w-12 md:h-14 md:w-14 object-contain" />
            <div>
              <h1 className="text-xl md:text-3xl font-bold tracking-tight">
                SAVAGE <span className="text-orange-500">CHAINSAWS</span>
              </h1>
              <p className="text-gray-400 text-sm">Unit Tracking Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <form className="flex items-center gap-2 sm:gap-3">
              <select name="customer" defaultValue={selectedCustomerId || ''} className="bg-zinc-900 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 max-w-[200px] sm:max-w-none">
                <option value="">All Customers (Action Center)</option>
                {customers?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button type="submit" className="bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition">Switch</button>
            </form>
            <Link
              href="/reports"
              className="border border-zinc-600 hover:border-orange-500 text-xs px-3 py-1.5 rounded-lg"
            >
              Reports
            </Link>
            <Link
              href="/inventory"
              className="border border-zinc-600 hover:border-orange-500 text-xs px-3 py-1.5 rounded-lg"
            >
              Inventory
            </Link>
            <Link
              href="/parts"
              className="border border-zinc-600 hover:border-orange-500 text-xs px-3 py-1.5 rounded-lg"
            >
              Parts
            </Link>
            <Link
              href="/invoices"
              className="border border-zinc-600 hover:border-orange-500 text-xs px-3 py-1.5 rounded-lg"
            >
              Invoices
            </Link>
            <Link
              href="/rentals"
              className="border border-zinc-600 hover:border-orange-500 text-xs px-3 py-1.5 rounded-lg"
            >
              Rentals
            </Link>
            <ContactLinksBar />
            <PushToggle label="Push" />
            <AdminLogout />
          </div>
        </div>

        <Suspense fallback={null}><LastViewedBanner customers={customers || []} /></Suspense>

        {currentCustomer && (
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xl font-semibold text-orange-400">{currentCustomer.name}</p>
              <p className="text-sm text-gray-400">Total Units: <span className="text-white font-medium">{units?.length || 0}</span></p>
              <p className="text-xs text-gray-500 mt-1">
                {currentCustomer.email || 'No portal login email on file'}
                {currentCustomer.phone ? ` · ${currentCustomer.phone}` : ''}
              </p>
            </div>
            <EditCustomerButton
              customer={{
                id: currentCustomer.id,
                name: currentCustomer.name,
                email: currentCustomer.email,
                secondary_email: currentCustomer.secondary_email,
                phone: currentCustomer.phone,
                payment_plans_enabled: currentCustomer.payment_plans_enabled,
              }}
              action={updateCustomerDetails}
            />
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-2 mb-4 md:mb-6">
          {tiles.map(tile => {
            const href = selectedCustomerId
              ? `/?customer=${selectedCustomerId}&status=${encodeURIComponent(tile.key)}`
              : `/?status=${encodeURIComponent(tile.key)}`
            const active = statusFilter === tile.key
            return (
              <Link
                key={tile.key}
                href={href}
                className={`bg-zinc-900 border rounded-lg px-3 py-1.5 md:py-2 transition hover:border-orange-500/60 flex flex-col items-center justify-center gap-0.5 ${
                  active ? 'border-orange-500' : 'border-zinc-800'
                }`}
              >
                <p className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wider text-center leading-tight">
                  {tile.label}
                </p>
                <p className={`text-xl md:text-2xl font-bold ${tile.color} text-center leading-none`}>{tile.count}</p>
              </Link>
            )
          })}
        </div>

        {statusFilter && (
          <div className="bg-zinc-900 border border-orange-400/40 rounded-xl overflow-hidden mb-5">
            <div className="px-4 sm:px-6 py-3 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-orange-300">
                  {statusFilter === 'Units' ? 'All Units' : statusFilter} ({statusFilteredUnits.length})
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">Click a unit below to expand and update it directly</p>
              </div>
              <Link
                href={selectedCustomerId ? `/?customer=${selectedCustomerId}` : '/'}
                className="text-sm text-gray-400 hover:text-white border border-zinc-700 rounded-lg px-4 py-2 transition"
              >
                {'<-'} Back to {selectedCustomerId ? 'customer' : 'Action Center'}
              </Link>
            </div>
            {statusFilteredUnits.length === 0 ? (
              <p className="px-4 sm:px-6 py-5 text-gray-500 text-sm">No units found.</p>
            ) : (
              <div className="p-3 sm:p-4 space-y-4">
                {groupUnitsByCustomer(statusFilteredUnits).map(group => (
                  <div
                    key={group.customer?.id || 'unknown'}
                    className="rounded-lg overflow-hidden"
                    style={{ border: `2px solid ${group.customer?.brand_color || SAVAGE_BRAND_COLOR}` }}
                  >
                    <CustomerGroupHeader customer={group.customer} count={group.units.length} />
                    <div className="divide-y divide-zinc-800/60 flex flex-col">
                      {group.units.map(unit => (
                        <UnitDetailPanel key={unit.id} unit={unit} accordionName="status-queue-unit" />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!selectedCustomerId && !statusFilter && (
          <>
            {priorityUnits.length > 0 && (
              <div className="bg-zinc-900 border border-orange-500/50 rounded-xl overflow-hidden mb-5">
                <div className="px-4 sm:px-6 py-3 border-b border-zinc-800"><h2 className="text-lg font-semibold text-orange-400">Priority Units ({priorityUnits.length})</h2></div>
                <div className="p-3 sm:p-4 space-y-4">
                  <GroupedActionList
                    units={priorityUnits}
                    borderColor="border-orange-500"
                    renderExtra={unit => (
                      <p className="text-sm text-orange-300">{unit.expedite_fee ? `Expedite fee: $${Number(unit.expedite_fee).toFixed(2)}` : 'Priority flag set'}</p>
                    )}
                  />
                </div>
              </div>
            )}
            {readyForPickupUnits.length > 0 && (
              <div className="bg-zinc-900 border border-green-500/40 rounded-xl overflow-hidden mb-5">
                <div className="px-4 sm:px-6 py-3 border-b border-zinc-800"><h2 className="text-lg font-semibold text-green-300">Ready for Pickup ({readyForPickupUnits.length})</h2></div>
                <div className="p-3 sm:p-4 space-y-4">
                  <GroupedActionList
                    units={readyForPickupUnits}
                    borderColor="border-green-400"
                    renderExtra={unit => (
                      <p className="text-sm text-green-300">{unit.notes || 'Ready for customer pickup'}</p>
                    )}
                  />
                </div>
              </div>
            )}
            {repairRequestedUnits.length > 0 && (
              <div className="bg-zinc-900 border border-blue-500/30 rounded-xl overflow-hidden mb-5">
                <div className="px-4 sm:px-6 py-3 border-b border-zinc-800"><h2 className="text-lg font-semibold text-blue-300">Repair Requested ({repairRequestedUnits.length})</h2></div>
                <div className="p-3 sm:p-4 space-y-4">
                  <GroupedActionList
                    units={repairRequestedUnits}
                    borderColor="border-blue-400"
                    renderExtra={unit => (
                      <p className="text-sm text-blue-300">{unit.notes || unit.problem_type || 'Customer requested repair'}</p>
                    )}
                  />
                </div>
              </div>
            )}
            {diagnosingUnits.length > 0 && (
              <div className="bg-zinc-900 border border-orange-500/30 rounded-xl overflow-hidden mb-5">
                <div className="px-4 sm:px-6 py-3 border-b border-zinc-800"><h2 className="text-lg font-semibold text-orange-400">Diagnosing ({diagnosingUnits.length})</h2></div>
                <div className="p-3 sm:p-4 space-y-4">
                  <GroupedActionList
                    units={diagnosingUnits}
                    borderColor="border-orange-500"
                    renderExtra={unit => (
                      <p className="text-sm text-orange-300">{unit.problem_type || unit.notes || 'In diagnosis'}</p>
                    )}
                  />
                </div>
              </div>
            )}
            {staleUnits.length > 0 && (
              <div className="bg-zinc-900 border border-red-500/30 rounded-xl overflow-hidden mb-5">
                <div className="px-4 sm:px-6 py-3 border-b border-zinc-800 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-red-400">Stagnant Units ({staleUnits.length})</h2>
                  <p className="text-xs text-red-300/80">Over 7 days with no action</p>
                </div>
                <div className="p-3 sm:p-4 space-y-4">
                  <GroupedActionList
                    units={staleUnits}
                    borderColor="border-red-500"
                    renderExtra={unit => (
                      <p className="text-sm text-red-400 font-medium">No action for {unit.daysSinceCheckIn} days</p>
                    )}
                  />
                </div>
              </div>
            )}
            {approvedDecisions.length > 0 && (
              <div className="bg-zinc-900 border border-green-500/30 rounded-xl overflow-hidden mb-5">
                <div className="px-4 sm:px-6 py-3 border-b border-zinc-800"><h2 className="text-lg font-semibold text-green-400">Customer Approved ({approvedDecisions.length})</h2></div>
                <div className="p-3 sm:p-4 space-y-4">
                  <GroupedActionList
                    units={approvedDecisions}
                    borderColor="border-green-500"
                    renderExtra={unit => (
                      <p className="text-sm text-green-300 font-medium">{unit.notes}</p>
                    )}
                  />
                </div>
              </div>
            )}
            {deniedDecisions.length > 0 && (
              <div className="bg-zinc-900 border border-red-500/30 rounded-xl overflow-hidden mb-5">
                <div className="px-4 sm:px-6 py-3 border-b border-zinc-800"><h2 className="text-lg font-semibold text-red-400">Customer Denied ({deniedDecisions.length})</h2></div>
                <div className="p-3 sm:p-4 space-y-4">
                  <GroupedActionList
                    units={deniedDecisions}
                    borderColor="border-red-500"
                    renderExtra={unit => (
                      <p className="text-sm text-red-300 font-medium">{unit.notes}</p>
                    )}
                  />
                </div>
              </div>
            )}
            <div className="bg-zinc-900 border border-yellow-500/30 rounded-xl overflow-hidden mb-5">
              <div className="px-4 sm:px-6 py-3 border-b border-zinc-800"><h2 className="text-lg font-semibold text-yellow-400">Waiting on Customer ({waitingOnCustomer.length})</h2></div>
              {waitingOnCustomer.length === 0 ? (
                <p className="px-4 sm:px-6 py-5 text-gray-500 text-sm">No units currently waiting on customer approval.</p>
              ) : (
                <div className="p-3 sm:p-4 space-y-4">
                  <GroupedActionList
                    units={waitingOnCustomer}
                    borderColor="border-yellow-500"
                    renderExtra={() => (
                      <p className="text-sm text-yellow-300">Waiting for customer decision</p>
                    )}
                  />
                </div>
              )}
            </div>
          </>
        )}

        {selectedCustomerId && !statusFilter && (
          <>
            <details
              className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-4 group"
              open={!!openUnitId && repairUnits.some(u => u.id === openUnitId)}
            >
              <summary className="px-4 sm:px-6 py-3 cursor-pointer list-none flex items-center justify-between hover:bg-zinc-800/40 transition">
                <h2 className="font-semibold text-orange-400">All Units - Repair Flow ({repairUnits.length})</h2>
                <span className="text-gray-500 text-sm group-open:rotate-180 transition">v</span>
              </summary>
              <div className="border-t border-zinc-800 divide-y divide-zinc-800 flex flex-col">
                {repairUnits.length === 0 && (
                  <p className="px-4 sm:px-6 py-5 text-gray-500 text-sm">No active repair units.</p>
                )}
                {repairUnits.map(unit => (
                  <UnitDetailPanel key={unit.id} unit={unit} accordionName="repair-unit" />
                ))}
              </div>
            </details>

            <details className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-4 group">
              <summary className="px-4 sm:px-6 py-3 cursor-pointer list-none flex items-center justify-between hover:bg-zinc-800/40 transition">
                <h2 className="font-semibold text-orange-400">Check In New Unit</h2>
                <span className="text-gray-500 text-sm group-open:rotate-180 transition">v</span>
              </summary>
              <div className="border-t border-zinc-800 p-4 sm:p-6">
                <CheckInForm customerId={selectedCustomerId} addUnitAction={addUnit} />
              </div>
            </details>

            <details className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-4 group">
              <summary className="px-4 sm:px-6 py-3 cursor-pointer list-none flex items-center justify-between hover:bg-zinc-800/40 transition">
                <div className="flex items-center gap-3">
                  <h2 className="font-semibold text-orange-300">Fleet Units ({sortedFleet.length})</h2>
                  <span className="text-xs text-gray-500 hidden sm:inline inline-flex items-center gap-3">
                    <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-green-500" />Serviced</span>
                    <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-orange-500" />Known</span>
                    <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-red-500" />Due</span>
                  </span>
                </div>
                <span className="text-gray-500 text-sm group-open:rotate-180 transition">v</span>
              </summary>
              <div className="border-t border-zinc-800">
                <details className="border-b border-zinc-800">
                  <summary className="px-4 sm:px-6 py-3 cursor-pointer list-none flex items-center gap-2 text-sm text-orange-400 hover:text-orange-300 hover:bg-zinc-800/30 transition">
                    <span className="text-lg leading-none">+</span>
                    <span className="font-medium">Add Unit to Fleet</span>
                  </summary>
                  <form action={addFleetUnit} className="px-4 sm:px-6 pb-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <input type="hidden" name="customer_id" value={selectedCustomerId} />
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Model</label>
                      <input name="model" placeholder="e.g. RZ 752" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Serial Number *</label>
                      <input name="serial" required className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                      <p className="text-xs text-gray-600 mt-1">
                        Illegible plate? Use a custom ID instead (e.g. BR800CE-1) - tracked the same as a real serial.
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Nickname (optional)</label>
                      <TitleCaseInput name="nickname" placeholder="e.g. T1" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Equipment Type</label>
                      <select name="equipment_type" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm">
                        <option>Riding Mower</option>
                        <option>Walk-Behind Mower</option>
                        <option>Chainsaw</option>
                        <option>Pole Saw</option>
                        <option>String Trimmer</option>
                        <option>Hedge Trimmer</option>
                        <option>Blower</option>
                        <option>Backpack Blower</option>
                        <option>Edger</option>
                        <option>Cutquik</option>
                        <option>Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Purchase Date</label>
                      <input type="date" name="purchase_date" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Last Service Date</label>
                      <input type="date" name="last_service_date" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Warranty End Date</label>
                      <input type="date" name="warranty_end" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Hour Meter</label>
                      <input name="hour_meter" placeholder="e.g. 12.5" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">Part Numbers</label>
                      <input name="part_numbers" placeholder="Parts needed..." className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <label className="block text-xs text-gray-500 mb-1">Fleet Notes</label>
                      <textarea name="fleet_notes" rows={2} placeholder="Anything about this unit..." className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <button type="submit" className="bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-5 py-2 rounded-lg">Add to Fleet</button>
                    </div>
                  </form>
                </details>

                {sortedFleet.length === 0 ? (
                  <p className="px-4 sm:px-6 py-5 text-gray-500 text-sm">No fleet units yet. Use + Add Unit to Fleet above.</p>
                ) : (
                  <div className="divide-y divide-zinc-800">
                    {sortedFleet.map(unit => {
                      const g = equipmentGroup(unit.equipment_type)
                      const showHeader = g !== lastGroup
                      if (showHeader) lastGroup = g
                      const color = getFleetColor(unit)
                      return (
                        <div key={unit.id}>
                          {showHeader && (
                            <div className="px-4 sm:px-6 py-2 bg-zinc-800/50">
                              <p className="text-xs uppercase tracking-wider text-gray-400 font-medium">{groupLabel(g)}</p>
                            </div>
                          )}
                          <details className="group/fleet">
                            <summary className="px-4 sm:px-6 py-3 cursor-pointer hover:bg-zinc-800/40 transition flex items-center justify-between gap-2">
                              <div className="flex items-center gap-3 min-w-0">
                                <span className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${color === 'red' ? 'bg-red-500' : color === 'green' ? 'bg-green-500' : 'bg-orange-500'}`} />
                                <UnitPhoto unit={unit} size="h-10 w-10" />
                                <div className="min-w-0">
                                  <p className="font-medium truncate">{unitLabel(unit)}</p>
                                  <p className="text-xs text-gray-500 truncate">
                                    Serial: {unit.serial_number || '-'}
                                    {unit.nickname ? ` - ${unit.nickname}` : ''}
                                    {unit.hour_meter ? ` - ${unit.hour_meter} hrs` : ''}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <WarrantyIcon
                                  underWarranty={isUnderWarranty(unit)}
                                  title={isUnderWarranty(unit) ? `Under warranty until ${formatShortDate(unit.warranty_end)}` : 'Not under warranty'}
                                />
                                {unit.shortblock_replaced && (
                                  <span className="text-xs px-2.5 py-1 rounded-full bg-purple-500/20 text-purple-400">Shortblock Replaced</span>
                                )}
                                <span className={`text-xs px-2.5 py-1 rounded-full ${
                                  unit.status === 'Fleet' ? 'bg-zinc-700 text-gray-300'
                                    : unit.status === 'Ready for Pickup' ? 'bg-green-500/20 text-green-400'
                                    : 'bg-orange-500/20 text-orange-400'
                                }`}>{unit.status}</span>
                              </div>
                            </summary>
                            <div className="px-4 sm:px-6 pb-4 space-y-3">
                              <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                                <span>Purchased: {formatShortDate(unit.purchase_date)}</span>
                                <span>Last service: {formatShortDate(unit.last_service_date)}</span>
                                <span>Warranty end: {formatShortDate(unit.warranty_end)}</span>
                              </div>
                              {unit.picked_up_by && (
                                <p className="text-xs text-gray-500">
                                  Picked up by <span className="text-gray-300">{unit.picked_up_by}</span> on {formatDate(unit.picked_up_at)}
                                </p>
                              )}
                              <form action={updateFleetUnit} className="space-y-3">
                                <input type="hidden" name="id" value={unit.id} />
                                <div className="grid sm:grid-cols-2 gap-3">
                                  <div>
                                    <label className="block text-xs text-gray-500 mb-1">Nickname</label>
                                    <TitleCaseInput name="nickname" defaultValue={unit.nickname || ''} placeholder="e.g. T1" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                                  </div>
                                  <div>
                                    <label className="block text-xs text-gray-500 mb-1">Serial Number</label>
                                    <input name="serial" defaultValue={unit.serial_number || ''} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                                    <p className="text-xs text-gray-600 mt-1">
                                      Illegible plate? Use a custom ID instead (e.g. BR800CE-1) - tracked the same as a real serial.
                                    </p>
                                  </div>
                                  <div>
                                    <label className="block text-xs text-gray-500 mb-1">Purchase Date</label>
                                    <input type="date" name="purchase_date" defaultValue={unit.purchase_date || ''} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                                  </div>
                                  <div>
                                    <label className="block text-xs text-gray-500 mb-1">Last Service Date</label>
                                    <input type="date" name="last_service_date" defaultValue={unit.last_service_date || ''} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                                  </div>
                                  <div>
                                    <label className="block text-xs text-gray-500 mb-1">Warranty End Date</label>
                                    <input type="date" name="warranty_end" defaultValue={unit.warranty_end || ''} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                                  </div>
                                  <div>
                                    <label className="block text-xs text-gray-500 mb-1">Hour Meter</label>
                                    <input name="hour_meter" defaultValue={unit.hour_meter || ''} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                                  </div>
                                  <div>
                                    <label className="block text-xs text-gray-500 mb-1">Part Numbers</label>
                                    <input name="part_numbers" defaultValue={unit.part_numbers || ''} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                                  </div>
                                </div>
                                <div>
                                  <label className="block text-xs text-gray-500 mb-1">Fleet Notes</label>
                                  <textarea name="fleet_notes" rows={2} defaultValue={unit.fleet_notes || ''} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                                </div>
                                <label className="flex items-start gap-2 text-sm text-gray-300 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    name="shortblock_replaced"
                                    value="true"
                                    defaultChecked={!!unit.shortblock_replaced}
                                    className="mt-0.5 rounded border-zinc-600 bg-zinc-800 text-orange-500 focus:ring-orange-500"
                                  />
                                  <span>
                                    <span className="text-orange-400 font-medium">Shortblock Replacement</span>
                                    <span className="block text-xs text-gray-500">
                                      Engine shortblock was swapped on this unit - keeps this same record and serial number rather than starting a new one.
                                    </span>
                                  </span>
                                </label>
                                <div className="flex gap-2">
                                  <button type="submit" className="bg-orange-600 hover:bg-orange-500 text-white text-sm px-4 py-1.5 rounded-lg">Save</button>
                                  <DeleteUnitButton id={unit.id} />
                                </div>
                              </form>

                              <UnitPhotosSection unit={unit} />
                              <BeforeAfterCompareSection unit={unit} />
                              <UnitPartsSection unit={unit} />
                              <UnitOrderSheetSection unit={unit} />
                              <ServiceHistorySection unit={unit} />
                              <CreateInvoiceSection unit={unit} />

                              {unit.status === 'Fleet' && (
                                <form action={scheduleFleetService} className="border-t border-zinc-800 pt-3 space-y-2">
                                  <input type="hidden" name="id" value={unit.id} />
                                  <label className="block text-xs text-gray-500">Schedule service / send to shop</label>
                                  <input
                                    name="service_note"
                                    placeholder="e.g. 3-month tune-up, won't start..."
                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                                  />
                                  <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-1.5 rounded-lg">
                                    Send to Repair Flow
                                  </button>
                                </form>
                              )}
                            </div>
                          </details>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </details>

            <details className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-4 group">
              <summary className="px-4 sm:px-6 py-3 cursor-pointer list-none flex items-center justify-between hover:bg-zinc-800/40 transition">
                <h2 className="font-semibold text-orange-300">Rentals ({(customerRentals || []).length})</h2>
                <span className="text-gray-500 text-sm group-open:rotate-180 transition">v</span>
              </summary>
              <div className="border-t border-zinc-800 p-4 sm:p-6 space-y-2">
                {(customerRentals || []).length === 0 ? (
                  <p className="text-gray-500 text-sm">No equipment rented from the shop&apos;s own fleet yet.</p>
                ) : (
                  (customerRentals || []).map(r => {
                    const unit = r.rental_units as unknown as { model: string; equipment_type: string } | null
                    return (
                      <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 bg-zinc-800/40 border border-zinc-800 rounded-lg px-3 py-2">
                        <div>
                          <p className="text-sm font-medium">{unit ? `${unit.model} - ${unit.equipment_type}` : 'Unknown Unit'}</p>
                          <p className="text-xs text-gray-500">
                            {new Date(r.start_date).toLocaleDateString()} → {new Date(r.end_date).toLocaleDateString()}
                            {Number(r.total_owed) > 0 ? ` · $${Number(r.total_owed).toFixed(2)} due` : r.paid_at ? ' · Paid' : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                            r.status === 'Active' ? 'bg-orange-500/20 text-orange-400' : 'bg-zinc-700 text-gray-300'
                          }`}>{r.status}</span>
                          {r.agreement_pdf_url && (
                            <a href={r.agreement_pdf_url} target="_blank" rel="noreferrer" className="text-xs text-orange-400 hover:text-orange-300">
                              Agreement
                            </a>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
                <Link
                  href={`/rentals?customer=${selectedCustomerId}`}
                  className="inline-block text-xs text-orange-400 hover:text-orange-300 underline pt-1"
                >
                  Manage Rentals →
                </Link>
              </div>
            </details>
          </>
        )}

        <details className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-4 group">
          <summary className="px-4 sm:px-6 py-3 cursor-pointer list-none flex items-center justify-between hover:bg-zinc-800/40 transition">
            <h2 className="font-semibold text-orange-400">Create Invoice</h2>
            <span className="text-gray-500 text-sm group-open:rotate-180 transition">v</span>
          </summary>
          <div className="border-t border-zinc-800 p-4 sm:p-6">
            <p className="text-xs text-gray-500 mb-3">
              Build a standalone itemized invoice on the spot - not tied to a tracked unit. Link an existing customer to auto-fill their info, or skip that and type everything from scratch.
            </p>
            <CreateCustomInvoiceForm
              customers={(customers || []).map(c => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, paymentPlansEnabled: !!c.payment_plans_enabled }))}
              defaultTaxRatePercent={defaultTaxRatePercent}
            />
          </div>
        </details>

        {/* Shop-wide admin tools, not scoped to any one customer - only
            shown in the Action Center (no customer selected) so they don't
            clutter the screen while looking at a specific customer's units.
            Referral Partners is deliberately left visible either way. */}
        {!selectedCustomerId && (
        <>
        <details className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-4 group">
          <summary className="px-4 sm:px-6 py-3 cursor-pointer list-none flex items-center justify-between hover:bg-zinc-800/40 transition">
            <h2 className="font-semibold text-orange-400">Shop Settings</h2>
            <span className="text-gray-500 text-sm group-open:rotate-180 transition">v</span>
          </summary>
          <div className="border-t border-zinc-800 p-4 sm:p-6">
            <ShopSettingsForm defaultTaxRatePercent={defaultTaxRatePercent} action={updateShopSetting} />
          </div>
        </details>

        <details className="bg-zinc-900 border border-red-900/40 rounded-xl overflow-hidden mb-4 group">
          <summary className="px-4 sm:px-6 py-3 cursor-pointer list-none flex items-center justify-between hover:bg-zinc-800/40 transition">
            <h2 className="font-semibold text-red-400">Delete Customer / Login</h2>
            <span className="text-gray-500 text-sm group-open:rotate-180 transition">v</span>
          </summary>
          <div className="border-t border-zinc-800 p-4 sm:p-6">
            <p className="text-xs text-gray-500 mb-3">
              Permanently removes a customer record and its login account (if any), via the proper Supabase Auth admin API. Refuses to run while the customer still has units attached - remove those first.
            </p>
            <DeleteCustomerLoginForm
              customers={(customers || []).map(c => ({ id: c.id, name: c.name }))}
              action={deleteCustomerLogin}
            />
          </div>
        </details>

        <details className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-4 group">
          <summary className="px-4 sm:px-6 py-3 cursor-pointer list-none flex items-center justify-between hover:bg-zinc-800/40 transition">
            <h2 className="font-semibold text-orange-400">Create Customer Login</h2>
            <span className="text-gray-500 text-sm group-open:rotate-180 transition">v</span>
          </summary>
          <div className="border-t border-zinc-800 p-4 sm:p-6">
            <p className="text-xs text-gray-500 mb-3">
              Creates the login for a customer directly (invite-only, not public signup). Links to an existing customer or creates a new one.
            </p>
            <CreateCustomerLoginForm
              customers={(customers || []).map(c => ({ id: c.id, name: c.name }))}
              action={createCustomerLogin}
            />
          </div>
        </details>

        <details className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-4 group">
          <summary className="px-4 sm:px-6 py-3 cursor-pointer list-none flex items-center justify-between hover:bg-zinc-800/40 transition">
            <h2 className="font-semibold text-orange-400">Instant Customer Signup Link</h2>
            <span className="text-gray-500 text-sm group-open:rotate-180 transition">v</span>
          </summary>
          <div className="border-t border-zinc-800 p-4 sm:p-6 space-y-3">
            <p className="text-xs text-gray-500">
              Text this link to someone on the spot - they sign up and get instant access, no admin review needed.
              Anyone without this exact link can&apos;t sign up at all. If the link ever leaks somewhere it shouldn&apos;t,
              regenerate it below to invalidate the old one immediately.
            </p>
            {instantSignupToken ? (
              <CopyInstantSignupLink token={instantSignupToken} />
            ) : (
              <p className="text-xs text-yellow-400">No link generated yet - click regenerate to create one.</p>
            )}
            <form action={regenerateInstantSignupToken}>
              <button
                type="submit"
                className="text-xs border border-zinc-600 hover:border-orange-500 text-gray-300 px-3 py-1.5 rounded-lg"
              >
                Regenerate Link
              </button>
            </form>
          </div>
        </details>
        </>
        )}

        <details className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-4 group">
          <summary className="px-4 sm:px-6 py-3 cursor-pointer list-none flex items-center justify-between hover:bg-zinc-800/40 transition">
            <h2 className="font-semibold text-orange-400">Referral Partners</h2>
            <span className="text-gray-500 text-sm group-open:rotate-180 transition">v</span>
          </summary>
          <div className="border-t border-zinc-800 p-4 sm:p-6 space-y-4">
            <p className="text-xs text-gray-500">
              Referral partners get their own read-only portal (<span className="text-orange-400">/referrer</span>) showing only the
              customers who signed up with their code. Add as many as you like here - each gets their own login.
            </p>
            {(referralSources || []).length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-zinc-800">
                      <th className="py-2 pr-3">Name</th>
                      <th className="py-2 pr-3">Code</th>
                      <th className="py-2 pr-3">Email</th>
                      <th className="py-2 pr-3">Phone</th>
                      <th className="py-2 pr-3">Signup Link</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {(referralSources || []).map(rs => (
                      <tr key={rs.id}>
                        <td className="py-2 pr-3 font-medium">{rs.name}</td>
                        <td className="py-2 pr-3 text-orange-400 font-mono">{rs.referral_code}</td>
                        <td className="py-2 pr-3 text-gray-400">{rs.contact_email}</td>
                        <td className="py-2 pr-3 text-gray-400">{rs.contact_phone || '-'}</td>
                        <td className="py-2 pr-3">
                          <CopyReferralLink code={rs.referral_code} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <CreateReferralSourceLoginForm action={createReferralSourceLogin} />
            {(referralSources || []).length > 0 && (
              <div className="pt-2 border-t border-zinc-800">
                <DeleteReferralSourceLoginForm
                  sources={(referralSources || []).map(rs => ({ id: rs.id, name: rs.name, referral_code: rs.referral_code }))}
                  action={deleteReferralSourceLogin}
                />
              </div>
            )}
          </div>
        </details>

        <SiteFooter />
      </div>
    </main>
  )
}

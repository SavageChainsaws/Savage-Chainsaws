'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import AppNav from '../components/AppNav'
import { UnitPhoto } from '../components/UnitPhoto'
import RentalSignCard from '../components/RentalSignCard'
import PaymentPlanCard from '../components/PaymentPlanCard'
import ContactLinksBar from '../components/ContactLinksBar'
import SiteFooter from '../components/SiteFooter'
import ReferralWelcomeScreen from '../components/ReferralWelcomeScreen'
import MediaLightbox from '../components/MediaLightbox'
import LogoSettingsCard from '../components/LogoSettingsCard'
import AccountSettingsCard from '../components/AccountSettingsCard'
import AddToFleetForm from '../components/AddToFleetForm'
import CustomerCheckInForm from '../components/CustomerCheckInForm'
import WarrantyShieldIcon from '../components/WarrantyShieldIcon'
import UnitCard from '../components/UnitCard'
import MyFleetTable from '../components/MyFleetTable'
import UnitsSummaryHeader from '../components/UnitsSummaryHeader'
import InvoiceListPanel from '../components/InvoiceListPanel'
import PrivateNoteEditor from '../components/PrivateNoteEditor'
import UnitDetailActions from '../components/UnitDetailActions'
import DiagnosisDecisionCard from '../components/DiagnosisDecisionCard'
import UnitPhotosAndHistory from '../components/UnitPhotosAndHistory'
import { notifyAuthChangedAcrossTabs } from '@/lib/authTabSync'
import { notifyAdminPush } from '@/lib/notifyAdminPush'
import { isUnderWarranty, unitLabel, warrantyCountdown, ACTIVE_STATUSES } from '@/lib/units'
import { formatShortDate } from '@/lib/dates'

const supabase = createClient()

type Unit = {
  id: string
  serial_number: string
  model: string | null
  status: string
  notes: string | null
  problem_type: string | null
  diagnosis_notes: string | null
  diagnosis_notes_updated_at: string | null
  equipment_type: string | null
  photo_url: string | null
  thumbnail_url: string | null
  invoice_url: string | null
  created_at: string
  is_priority: boolean | null
  customer_id: string
  nickname: string | null
  archived: boolean | null
  hour_meter: string | null
  warranty_end: string | null
  last_service_date: string | null
}

// Cost is intentionally left off this type/view - customers see date and
// work performed only; cost stays admin-only (shown on the admin dashboard's
// Service History section instead).
type ServiceHistoryEntry = {
  id: string
  service_date: string
  description: string
}

type UnitPhotoEntry = {
  id: string
  url: string
  caption: string | null
  media_type: 'photo' | 'video'
  stage: 'checkin' | 'diagnosis'
  created_at: string
}

type Customer = {
  id: string
  name: string
  email: string | null
  secondary_email: string | null
  logo_url: string | null
  brand_color: string | null
  referral_source_id: string | null
  referral_welcome_seen: boolean
}

type ReferralWelcomeInfo = { name: string; contact: string | null }

type InvoiceRow = {
  id: string
  invoice_number: string | null
  amount: number
  paid_at: string | null
  pdf_url: string | null
  created_at: string
  unit_id: string | null
}

export default function CustomerPortal() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [units, setUnits] = useState<Unit[]>([])
  const [referralWelcome, setReferralWelcome] = useState<ReferralWelcomeInfo | null>(null)
  const [dismissingWelcome, setDismissingWelcome] = useState(false)
  const [showCheckIn, setShowCheckIn] = useState(false)
  const [showAddFleet, setShowAddFleet] = useState(false)
  const [showLogoUpload, setShowLogoUpload] = useState(false)
  const [showMyFleet, setShowMyFleet] = useState(false)
  const [showActiveInvoices, setShowActiveInvoices] = useState(false)
  const [showArchivedInvoices, setShowArchivedInvoices] = useState(false)
  const [showSettingsMenu, setShowSettingsMenu] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null)
  const [serviceHistory, setServiceHistory] = useState<ServiceHistoryEntry[]>([])
  const [serviceHistoryLoading, setServiceHistoryLoading] = useState(false)
  const [unitPhotos, setUnitPhotos] = useState<UnitPhotoEntry[]>([])
  const [askingQuestion, setAskingQuestion] = useState(false)
  const detailRef = useRef<HTMLDivElement | null>(null)
  const replyInputRef = useRef<HTMLInputElement | null>(null)
  const unitsTopRef = useRef<HTMLDivElement | null>(null)

  // Lightbox for the Diagnosis Findings thumbnails shown inline in the
  // Repair Decision Needed card - a quick zoomed-in preview without
  // navigating away, so the customer can see the damage before deciding.
  const [lightboxMedia, setLightboxMedia] = useState<{ url: string; isVideo: boolean; caption: string | null } | null>(null)

  // Latest invoice/estimate total per unit_id, so the Needs Approval
  // prompt can show the dollar amount without the customer opening the
  // PDF - keyed off the previously-unused invoices table, now populated
  // by the admin's invoice tool (app/api/invoice/route.ts).
  const [invoiceTotals, setInvoiceTotals] = useState<Record<string, number>>({})

  // Latest invoice's own PDF per unit_id - the authoritative link for the
  // Needs Approval card (see below), rather than units.invoice_url, which
  // is a separate field that only an admin-initiated per-unit "Create
  // Invoice"/"Edit Invoice" or a manual photo upload sets, and never a
  // standalone/custom invoice (no real unit_id to link back to - see
  // app/api/invoice/custom/route.ts). Pulling straight from the invoices
  // table this way means the link always matches whatever was actually
  // just generated, no separate upload step required.
  const [invoicePdfUrls, setInvoicePdfUrls] = useState<Record<string, string>>({})

  // Every invoice ever billed to this customer (unit-linked and standalone
  // alike) - powers the Active Invoices / Archive buttons up top, including
  // the unpaid-count badge, so a customer can tell at a glance whether they
  // owe anything without opening email at all.
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])

  const [detailBusy, setDetailBusy] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    setMessage(null)
    let { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      // Backgrounding the app for a while (access token expires after ~1hr)
      // means this first getUser() call is what triggers the actual token
      // refresh on return - a one-off network blip right at resume time, or
      // a race with a concurrent refresh elsewhere using the same
      // soon-to-rotate refresh token, can fail that single attempt even
      // though the session is otherwise still perfectly valid. Retry once
      // before treating it as a real logout.
      await new Promise(resolve => setTimeout(resolve, 400))
      ;({ data: { user } } = await supabase.auth.getUser())
    }
    if (!user) {
      router.push('/customer/login')
      return
    }
    setUserEmail(user.email ?? null)

    // Wakes up any other tab still sitting on a login page - e.g. one a
    // magic-link email was requested from, if the link itself got opened
    // in a separate tab by the customer's email client - so it redirects
    // instead of being left showing the old logged-out form.
    notifyAuthChangedAcrossTabs()

    // Customer accounts are only ever linked by an admin (Create Customer
    // Login, which sets auth_user_id directly on the customers row) - there
    // is no self-service or automatic linking here. A signed-in user with
    // no linked customers row simply isn't a customer yet (see the !cust
    // branch below), regardless of what email they authenticated with.
    const { data: cust } = await supabase
      .from('customers')
      .select('id, name, email, secondary_email, logo_url, brand_color, referral_source_id, referral_welcome_seen')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    if (!cust) {
      // The authenticated session here isn't a customer at all - most
      // likely this browser also has an admin session (admin and customer
      // share one Supabase Auth cookie for the whole site, so whichever
      // account most recently authenticated in ANY tab is what a later
      // getUser() call here sees). Rather than stranding them on a dead
      // end "no customer account" screen tied to the wrong identity, send
      // them to where that identity actually belongs.
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()
      if (profile?.role === 'admin') {
        router.replace('/')
        return
      }
      setCustomer(null)
      setUnits([])
      setLoading(false)
      return
    }

    setCustomer(cust)

    // One-time branded welcome moment for a customer referred by a partner -
    // fetched here (rather than joined into the customers select above)
    // since it's only ever needed once, the first time this loads after
    // referral_source_id gets set. RLS scopes this to exactly the one
    // referral_sources row this customer is linked to (see "customers read
    // own referral source" in the add_referral_sources migration).
    if (cust.referral_source_id && !cust.referral_welcome_seen) {
      const { data: source } = await supabase
        .from('referral_sources')
        .select('name, contact_phone, contact_email')
        .eq('id', cust.referral_source_id)
        .maybeSingle()
      if (source) {
        setReferralWelcome({ name: source.name, contact: source.contact_phone || source.contact_email || null })
      }
    }
    const { data: unitData } = await supabase
      .from('units')
      .select('*')
      .eq('customer_id', cust.id)
      .or('archived.is.null,archived.eq.false')
      .order('created_at', { ascending: false })

    setUnits(unitData || [])

    // Latest invoice/estimate total per unit, for the Needs Approval
    // prompt - best-effort, a failed/empty read just means no total shows.
    const unitIds = (unitData || []).map(u => u.id)
    if (unitIds.length > 0) {
      const { data: invoiceRows } = await supabase
        .from('invoices')
        .select('unit_id, amount, pdf_url, created_at')
        .in('unit_id', unitIds)
        .order('created_at', { ascending: false })
      const totals: Record<string, number> = {}
      const pdfUrls: Record<string, string> = {}
      for (const row of invoiceRows || []) {
        if (!(row.unit_id in totals) && row.amount != null) totals[row.unit_id] = Number(row.amount)
        if (!(row.unit_id in pdfUrls) && row.pdf_url) pdfUrls[row.unit_id] = row.pdf_url
      }
      setInvoiceTotals(totals)
      setInvoicePdfUrls(pdfUrls)
    }

    const { data: allInvoices } = await supabase
      .from('invoices')
      .select('id, invoice_number, amount, paid_at, pdf_url, created_at, unit_id')
      .eq('customer_id', cust.id)
      .order('created_at', { ascending: false })
    setInvoices((allInvoices as InvoiceRow[]) || [])

    setLoading(false)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    notifyAuthChangedAcrossTabs()
    // Full page reload (not router.push) so the next page starts with a
    // completely fresh client/session state instead of racing signOut's
    // cookie-clearing against an in-flight soft navigation.
    window.location.href = '/login'
  }

  async function dismissReferralWelcome() {
    if (!customer) return
    setDismissingWelcome(true)
    await supabase.from('customers').update({ referral_welcome_seen: true }).eq('id', customer.id)
    setDismissingWelcome(false)
    setReferralWelcome(null)
  }

  function openUnit(unit: Unit) {
    setSelectedUnit(unit)
    setMessage(null)
    setShowCheckIn(false)
    setShowAddFleet(false)
    setShowLogoUpload(false)
    setShowMyFleet(false)
    setAskingQuestion(false)

    // The detail panel renders near the top of the page, well above the
    // Fleet/Other Units lists further down - without this, clicking a unit
    // card down there visibly does nothing, since the panel updates off-
    // screen above the click. The panel isn't in the DOM yet on this same
    // tick (state hasn't re-rendered), so the actual scroll happens in the
    // effect below once selectedUnit changes and the ref is attached.
    setServiceHistory([])
    setServiceHistoryLoading(true)
    supabase
      .from('service_history')
      .select('id, service_date, description')
      .eq('unit_id', unit.id)
      .order('service_date', { ascending: false })
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setServiceHistory(data || [])
        setServiceHistoryLoading(false)
      })

    setUnitPhotos([])
    supabase
      .from('unit_photos')
      .select('id, url, caption, media_type, stage, created_at')
      .eq('unit_id', unit.id)
      .order('created_at', { ascending: true })
      .then(({ data }) => setUnitPhotos(data || []))
  }

  function closeUnit() {
    setSelectedUnit(null)
    setServiceHistory([])
    setUnitPhotos([])
    setAskingQuestion(false)
  }

  // Scrolls the detail panel into view whenever a unit is opened, from any
  // section on the page (In Service, Fleet, or Other Units) - runs after
  // the panel has actually rendered for the newly-selected unit.
  useEffect(() => {
    if (selectedUnit?.id) {
      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [selectedUnit?.id])

  // "Ask a Question" on the Needs Approval prompt reuses the same
  // reply/message thread (see UnitMessageThread) rather than a separate
  // mechanism - it just brings the existing field into view and focus,
  // and highlights it briefly.
  function askQuestion() {
    setAskingQuestion(true)
    replyInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    replyInputRef.current?.focus()
  }

  async function archiveUnit() {
    if (!selectedUnit || !customer) return
    if (!confirm('Remove this unit from your list? Jesse will still keep a history of it.')) return
    setDetailBusy(true)
    const name = customer.name || userEmail || 'Customer'
    const historyLine = `${new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })} - Archived by ${name} (removed from customer list)`
    const { data: existing } = await supabase
      .from('units')
      .select('history')
      .eq('id', selectedUnit.id)
      .single()
    const { error } = await supabase
      .from('units')
      .update({
        archived: true,
        history: existing?.history ? `${historyLine}\n${existing.history}` : historyLine,
      })
      .eq('id', selectedUnit.id)
    setDetailBusy(false)
    if (error) {
      console.error(error)
      setMessage('Could not remove unit.')
      return
    }
    setMessage('Unit removed from your list.')
    closeUnit()
    await loadData()
  }

  async function handleDecision(unitId: string, decision: 'approve' | 'deny') {
    if (!customer) return
    const name = customer.name || userEmail || 'Customer'
    const status = decision === 'approve' ? 'In Repair' : 'Ready for Pickup'
    const note = decision === 'approve'
      ? `Approved by ${name}`
      : `Denied by ${name} - diagnosis fee $49.99 will apply`
    const { data: existing } = await supabase
      .from('units')
      .select('notes, history')
      .eq('id', unitId)
      .single()
    const historyLine = `${new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })} - ${note}`
    const { error } = await supabase
      .from('units')
      .update({
        status,
        status_since: new Date().toISOString(),
        notes: existing?.notes ? `${note}\n${existing.notes}` : note,
        notes_updated_at: new Date().toISOString(),
        decision_seen: false,
        history: existing?.history ? `${historyLine}\n${existing.history}` : historyLine,
      })
      .eq('id', unitId)
    if (error) {
      console.error(error)
      setMessage('Could not save decision. Try again.')
      return
    }
    notifyAdminPush('decision', unitId, decision)
    if (decision === 'deny') {
      // Applies the existing $49.99 diagnostic/check-in fee as a real,
      // itemized charge in Service History rather than just a note - this
      // is the same fee already messaged above, now logged as the actual
      // completed-service entry it represents.
      await supabase.from('service_history').insert({
        unit_id: unitId,
        description: `Diagnostic fee - repair denied by ${name}`,
        cost: 49.99,
      })
    }
    setMessage(
      decision === 'deny'
        ? 'Repair denied. A $49.99 diagnosis fee applies.'
        : 'Decision saved. Jesse has been notified.'
    )
    await loadData()
    if (selectedUnit?.id === unitId) closeUnit()
  }

  // Mirrors the admin dashboard's "pin the opened unit to the top of its
  // list" behavior - admin achieves this with CSS order on native
  // <details> elements, but these cards aren't <details> (they share one
  // detail panel instead of expanding in place), so the equivalent here
  // is just reordering the array before rendering. "Collapse others" is
  // already inherent - there's only ever one shared panel open at a time.
  function pinSelectedFirst<T extends { id: string }>(list: T[]): T[] {
    if (!selectedUnit) return list
    const idx = list.findIndex(u => u.id === selectedUnit.id)
    if (idx <= 0) return list
    const copy = [...list]
    const [item] = copy.splice(idx, 1)
    copy.unshift(item)
    return copy
  }

  const activeUnits = pinSelectedFirst(units.filter(u => ACTIVE_STATUSES.includes(u.status)))
  // A unit is in exactly one of these three lists at a time - once it's
  // checked in / has an active service request it moves out of Fleet and
  // shows only in "In Service" above; once that service completes
  // (markPickedUp sets status back to 'Fleet') it moves back out of "In
  // Service" and shows only here again, picking up its current
  // warranty_end and most recent service_history entry automatically
  // since those are read live off the same unit row, not duplicated.
  const fleetUnits = pinSelectedFirst(units.filter(u => u.status === 'Fleet'))
  const otherUnits = pinSelectedFirst(units.filter(
    u => !ACTIVE_STATUSES.includes(u.status) && u.status !== 'Fleet'
  ))

  const needsApproval = units.filter(u => u.status === 'Needs Approval').length

  const activeInvoices = invoices.filter(i => !i.paid_at)

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </main>
    )
  }

  if (!customer) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white p-6">
        <div className="max-w-lg mx-auto mt-20 text-center space-y-4">
          <img src="/images/logo.png" alt="Savage Chainsaws" className="h-16 w-16 mx-auto object-contain" />
          <h1 className="text-2xl font-bold">
            SAVAGE <span className="text-orange-500">CHAINSAWS</span>
          </h1>
          <p className="text-gray-400">
            No customer account is linked to <span className="text-white">{userEmail}</span> yet.
          </p>
          <p className="text-sm text-gray-500">
            Ask Jesse to add your email to your company record, then refresh.
          </p>
          <button
            onClick={handleLogout}
            className="mt-4 border border-zinc-700 rounded-lg px-4 py-2 text-sm hover:bg-zinc-800"
          >
            Log out
          </button>
        </div>
        <div className="max-w-lg mx-auto">
          <SiteFooter />
        </div>
      </main>
    )
  }

  if (referralWelcome) {
    return (
      <ReferralWelcomeScreen
        referrerName={referralWelcome.name}
        referrerContact={referralWelcome.contact}
        busy={dismissingWelcome}
        onContinue={dismissReferralWelcome}
      />
    )
  }

  const canEditDetails =
    selectedUnit &&
    (selectedUnit.status === 'Fleet' ||
      selectedUnit.status === 'Registered')

  const headerLogo = customer.logo_url || '/images/logo.png'

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-zinc-800 px-4 sm:px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img
              src={headerLogo}
              alt={customer.name}
              className="h-10 w-10 object-contain rounded-lg bg-zinc-900 border border-zinc-700"
            />
            <div>
              <p className="font-bold text-lg leading-tight">{customer.name}</p>
              <p className="text-xs text-gray-500">
                Powered by <span className="text-orange-400">Savage Chainsaws</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="text-right hidden sm:block">
              <p className="font-medium">{userEmail}</p>
            </div>
            <ContactLinksBar />
            <button
              onClick={handleLogout}
              className="border border-zinc-700 rounded-lg px-3 py-1.5 hover:bg-zinc-800 transition"
            >
              Log out
            </button>
            <div className="relative">
              <button
                onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                aria-label="Menu"
                className="h-9 w-9 flex items-center justify-center rounded-lg border border-zinc-700 hover:border-orange-500 transition text-xl leading-none"
              >
                &#8942;
              </button>
              {showSettingsMenu && (
                <div className="absolute right-0 top-full mt-2 w-40 bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg overflow-hidden z-10">
                  <button
                    onClick={() => {
                      setShowSettingsMenu(false)
                      setShowSettings(!showSettings)
                      setShowActiveInvoices(false)
                      setShowArchivedInvoices(false)
                      setShowAddFleet(false)
                      setShowCheckIn(false)
                      setShowLogoUpload(false)
                      setShowMyFleet(false)
                      closeUnit()
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-zinc-800 transition"
                  >
                    Settings
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto p-3 sm:p-4 space-y-4">
        <UnitsSummaryHeader
          units={units}
          onOpen={openUnit}
          onScrollToUnits={() => unitsTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        />

        {message && (
          <div className="bg-zinc-900 border border-orange-500/40 rounded-xl px-4 py-3 text-sm text-orange-300">
            {message}
          </div>
        )}

        {customer && <RentalSignCard customerId={customer.id} />}
        {customer && <PaymentPlanCard customerId={customer.id} />}

        <div className="flex flex-wrap justify-end gap-2">
          <button
            onClick={() => {
              setShowActiveInvoices(!showActiveInvoices)
              setShowArchivedInvoices(false)
              setShowAddFleet(false)
              setShowCheckIn(false)
              setShowLogoUpload(false)
              setShowMyFleet(false)
              setShowSettings(false)
              closeUnit()
            }}
            className="relative border border-zinc-600 hover:border-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            {showActiveInvoices ? 'Close' : 'Active Invoices'}
            {activeInvoices.length > 0 && (
              <span className="absolute -top-2 -right-2 h-5 min-w-5 px-1 flex items-center justify-center rounded-full bg-red-600 text-white text-xs font-bold">
                {activeInvoices.length}
              </span>
            )}
          </button>
          <button
            onClick={() => {
              setShowArchivedInvoices(!showArchivedInvoices)
              setShowActiveInvoices(false)
              setShowAddFleet(false)
              setShowCheckIn(false)
              setShowLogoUpload(false)
              setShowMyFleet(false)
              setShowSettings(false)
              closeUnit()
            }}
            className="border border-zinc-600 hover:border-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            {showArchivedInvoices ? 'Close' : 'Archive'}
          </button>
          <button
            onClick={() => {
              setShowLogoUpload(!showLogoUpload)
              setShowActiveInvoices(false)
              setShowArchivedInvoices(false)
              setShowAddFleet(false)
              setShowCheckIn(false)
              setShowMyFleet(false)
              setShowSettings(false)
              closeUnit()
            }}
            className="border border-zinc-600 hover:border-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            {showLogoUpload ? 'Close' : 'Company Logo'}
          </button>
          <button
            onClick={() => {
              setShowMyFleet(!showMyFleet)
              setShowActiveInvoices(false)
              setShowArchivedInvoices(false)
              setShowAddFleet(false)
              setShowCheckIn(false)
              setShowLogoUpload(false)
              setShowSettings(false)
              closeUnit()
            }}
            className="relative border border-zinc-600 hover:border-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            {showMyFleet ? 'Close' : 'My Fleet'}
            {needsApproval > 0 && (
              <span className="absolute -top-2 -right-2 h-5 min-w-5 px-1 flex items-center justify-center rounded-full bg-red-600 text-white text-xs font-bold">
                {needsApproval}
              </span>
            )}
          </button>
          <button
            onClick={() => {
              setShowAddFleet(!showAddFleet)
              setShowActiveInvoices(false)
              setShowArchivedInvoices(false)
              setShowCheckIn(false)
              setShowLogoUpload(false)
              setShowMyFleet(false)
              setShowSettings(false)
              closeUnit()
            }}
            className="border border-zinc-600 hover:border-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            {showAddFleet ? 'Close' : 'Add to Fleet'}
          </button>
          <AppNav />
          <button
            onClick={() => {
              setShowCheckIn(!showCheckIn)
              setShowActiveInvoices(false)
              setShowArchivedInvoices(false)
              setShowAddFleet(false)
              setShowLogoUpload(false)
              setShowMyFleet(false)
              setShowSettings(false)
              closeUnit()
            }}
            className="bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            {showCheckIn ? 'Close Check-In' : 'Check In a Unit'}
          </button>
        </div>

        {showActiveInvoices && (
          <InvoiceListPanel invoices={invoices} units={units} mode="active" />
        )}
        {showArchivedInvoices && (
          <InvoiceListPanel invoices={invoices} units={units} mode="archived" />
        )}

        {showMyFleet && (
          <MyFleetTable units={units} onOpen={openUnit} />
        )}

        {showLogoUpload && (
          <LogoSettingsCard
            customer={customer}
            onUpdate={updates => setCustomer(prev => prev ? { ...prev, ...updates } : null)}
            onMessage={setMessage}
            onSaved={() => setShowLogoUpload(false)}
          />
        )}

        {showAddFleet && (
          <AddToFleetForm
            customerId={customer.id}
            onMessage={setMessage}
            onAdded={async () => {
              setShowAddFleet(false)
              await loadData()
            }}
          />
        )}

        {showCheckIn && (
          <CustomerCheckInForm
            customerId={customer.id}
            onMessage={setMessage}
            onCheckedIn={async () => {
              setShowCheckIn(false)
              await loadData()
            }}
          />
        )}

        {showSettings && (
          <AccountSettingsCard
            customer={customer}
            onUpdate={updates => setCustomer(prev => prev ? { ...prev, ...updates } : null)}
            onMessage={setMessage}
          />
        )}

        {selectedUnit && (
          <div ref={detailRef} className="bg-zinc-900 border border-orange-500/40 rounded-xl p-4 sm:p-5 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex gap-3 min-w-0">
                <UnitPhoto unit={selectedUnit} size="h-16 w-16" />
                <div className="min-w-0">
                  <p className="font-semibold text-lg truncate">{unitLabel(selectedUnit)}</p>
                  {selectedUnit.nickname && (
                    <p className="text-sm text-gray-400">{selectedUnit.nickname}</p>
                  )}
                  {selectedUnit.problem_type && selectedUnit.status !== 'Fleet' && (
                    <p className="text-sm text-gray-500 mt-0.5">Problem: {selectedUnit.problem_type}</p>
                  )}
                  <span className={`inline-block mt-1 text-xs px-2.5 py-1 rounded-full font-medium ${
                    selectedUnit.status === 'Needs Approval' ? 'bg-yellow-500/20 text-yellow-400'
                      : selectedUnit.status === 'Fleet' ? 'bg-zinc-600 text-gray-300'
                      : selectedUnit.status === 'Ready for Pickup' ? 'bg-green-500/20 text-green-400'
                      : 'bg-orange-500/20 text-orange-400'
                  }`}>{selectedUnit.status}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-zinc-700 text-gray-300">
                  Serial: {selectedUnit.serial_number || '-'}
                </span>
                <WarrantyShieldIcon underWarranty={isUnderWarranty(selectedUnit)} />
                <button
                  onClick={closeUnit}
                  className="text-gray-400 hover:text-white text-sm border border-zinc-700 rounded-lg px-3 py-1.5"
                >
                  Close
                </button>
              </div>
            </div>

            {(() => {
              const countdown = warrantyCountdown(selectedUnit.warranty_end)
              if (!countdown) return null
              return (
                <p className={`text-xs font-bold ${countdown.colorClass}`}>
                  Warranty: {countdown.label} - end date {formatShortDate(selectedUnit.warranty_end)}
                </p>
              )
            })()}

            {canEditDetails && serviceHistory.length > 0 && (
              <div className="border-t border-zinc-800 pt-3">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Most Recent Service</p>
                <p className="text-xs text-gray-500">{formatShortDate(serviceHistory[0].service_date)}</p>
                <p className="text-sm text-gray-300 whitespace-pre-wrap">{serviceHistory[0].description}</p>
              </div>
            )}

            {canEditDetails && (
              <PrivateNoteEditor key={selectedUnit.id} unitId={selectedUnit.id} onMessage={setMessage} />
            )}

            <UnitDetailActions
              key={selectedUnit.id}
              unit={selectedUnit}
              customerName={customer.name || userEmail || 'Customer'}
              busy={detailBusy}
              onBusyChange={setDetailBusy}
              onMessage={setMessage}
              onLoadData={loadData}
              onUnitUpdated={updates => setSelectedUnit(prev => prev ? { ...prev, ...updates } : null)}
              onClose={closeUnit}
            />

            <DiagnosisDecisionCard
              unit={selectedUnit}
              unitPhotos={unitPhotos}
              estimateTotal={invoiceTotals[selectedUnit.id] ?? null}
              pdfUrl={invoicePdfUrls[selectedUnit.id] || selectedUnit.invoice_url || null}
              customerId={customer.id}
              customerName={customer.name || userEmail || 'Customer'}
              onMessage={setMessage}
              inputRef={replyInputRef}
              highlighted={askingQuestion}
              onLightboxOpen={setLightboxMedia}
              onApprove={() => handleDecision(selectedUnit.id, 'approve')}
              onDeny={() => handleDecision(selectedUnit.id, 'deny')}
              onAskQuestion={askQuestion}
            />

            <UnitPhotosAndHistory
              unit={selectedUnit}
              unitPhotos={unitPhotos}
              serviceHistory={serviceHistory}
              serviceHistoryLoading={serviceHistoryLoading}
            />

            <div className="border-t border-zinc-800 pt-3">
              <button
                onClick={archiveUnit}
                disabled={detailBusy}
                className="text-sm text-red-400 hover:text-red-300 disabled:opacity-50"
              >
                Remove from my list
              </button>
            </div>
          </div>
        )}

        <MediaLightbox media={lightboxMedia} onClose={() => setLightboxMedia(null)} />

        <div ref={unitsTopRef} className="bg-zinc-900 border border-zinc-800 border-l-4 border-l-orange-500 rounded-xl overflow-hidden">
          <div className="px-4 sm:px-6 py-3 border-b border-zinc-800 bg-orange-500/10">
            <h2 className="text-lg font-semibold text-orange-400">
              In Service ({activeUnits.length})
            </h2>
          </div>
          <div className="p-3 sm:p-4">
            {activeUnits.length === 0 ? (
              <p className="text-gray-500 text-sm">No units currently in service.</p>
            ) : (
              <div className="space-y-2">
                {activeUnits.map(unit => (
                  <UnitCard key={unit.id} unit={unit} onOpen={openUnit} />
                ))}
              </div>
            )}
          </div>
        </div>

        <details className="bg-zinc-900 border border-zinc-800 border-l-4 border-l-blue-500 rounded-xl overflow-hidden group" open={fleetUnits.length > 0 && fleetUnits.length <= 6}>
          <summary className="cursor-pointer list-none flex items-center justify-between px-4 sm:px-6 py-3 bg-blue-500/10 hover:bg-blue-500/20 transition">
            <h2 className="text-lg font-semibold text-blue-300">
              Fleet ({fleetUnits.length})
            </h2>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation()
                  setShowAddFleet(!showAddFleet)
                  setShowCheckIn(false)
                  setShowLogoUpload(false)
                  setShowMyFleet(false)
                  setShowSettings(false)
                  closeUnit()
                }}
                className="border border-zinc-600 hover:border-orange-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition"
              >
                {showAddFleet ? 'Close' : 'Add to Fleet'}
              </button>
              <span className="text-blue-300/70 text-sm group-open:rotate-180 transition">v</span>
            </div>
          </summary>
          <div className="border-t border-zinc-800 p-3 sm:p-4 space-y-2">
            {fleetUnits.length === 0 ? (
              <p className="text-gray-500 text-sm px-1">
                No fleet units yet. Use <strong>Add to Fleet</strong> to register equipment.
              </p>
            ) : (
              fleetUnits.map(unit => <UnitCard key={unit.id} unit={unit} onOpen={openUnit} />)
            )}
          </div>
        </details>

        <details className="bg-zinc-900 border border-zinc-800 border-l-4 border-l-purple-500 rounded-xl overflow-hidden group">
          <summary className="cursor-pointer list-none flex items-center justify-between px-4 sm:px-6 py-3 bg-purple-500/10 hover:bg-purple-500/20 transition">
            <h2 className="text-lg font-semibold text-purple-300">
              Other Units ({otherUnits.length})
            </h2>
            <span className="text-purple-300/70 text-sm group-open:rotate-180 transition">v</span>
          </summary>
          <div className="border-t border-zinc-800 p-3 sm:p-4 space-y-2">
            {otherUnits.length === 0 ? (
              <p className="text-gray-500 text-sm px-1">No completed or other units.</p>
            ) : (
              otherUnits.map(unit => <UnitCard key={unit.id} unit={unit} onOpen={openUnit} />)
            )}
          </div>
        </details>

        <SiteFooter />
      </div>
    </main>
  )
}

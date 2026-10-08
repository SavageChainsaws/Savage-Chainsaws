'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import AppNav from '../components/AppNav'
import { UnitPhoto } from '../components/UnitPhoto'
import { UnitPhotoGallery } from '../components/UnitPhotoGallery'
import { BeforeAfterCompare } from '../components/BeforeAfterCompare'
import RentalSignCard from '../components/RentalSignCard'
import PaymentPlanCard from '../components/PaymentPlanCard'
import ContactLinksBar from '../components/ContactLinksBar'
import SiteFooter from '../components/SiteFooter'
import ReferralWelcomeScreen from '../components/ReferralWelcomeScreen'
import MediaLightbox from '../components/MediaLightbox'
import LogoSettingsCard from '../components/LogoSettingsCard'
import AccountSettingsCard from '../components/AccountSettingsCard'
import AddToFleetForm from '../components/AddToFleetForm'
import { notifyAuthChangedAcrossTabs } from '@/lib/authTabSync'
import { liveTitleCase, toTitleCase } from '@/lib/text'
import { isUnderWarranty, isIdentifyingSerial, escapeLikePattern, STIHL_PREFIX_MAP, EQUIPMENT_CATEGORIES } from '@/lib/units'
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

// Read-only shield indicator, reusing the same isUnderWarranty()/
// warranty_end data as the admin side's Fleet Units icon - sized larger
// (h-5 w-5 vs admin's h-4 w-4) since customer screens benefit from more
// visibility here than a dense admin list does.
function WarrantyShieldIcon({ underWarranty }: { underWarranty: boolean }) {
  return (
    <span
      title={underWarranty ? 'Under warranty' : 'Not under warranty'}
      className={`shrink-0 ${underWarranty ? 'text-blue-400' : 'text-zinc-600'}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill={underWarranty ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="M12 2 4 5v6c0 5 3.4 8.7 8 11 4.6-2.3 8-6 8-11V5l-8-3Z" />
        {underWarranty && <path d="m9 12 2 2 4-4" stroke="#09090b" />}
      </svg>
    </span>
  )
}

// A live, color-coded countdown - never a bare negative number, and never
// silently disappears once the end date has passed, so a customer can't
// mistake "no warning shown" for "still covered."
function warrantyCountdown(warrantyEnd: string | null): { label: string; colorClass: string } | null {
  if (!warrantyEnd) return null
  const end = new Date(`${warrantyEnd}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const daysLeft = Math.round((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (daysLeft < 0) return { label: 'Expired', colorClass: 'text-red-400' }
  if (daysLeft === 0) return { label: 'Expires today', colorClass: 'text-red-400' }
  if (daysLeft <= 30) return { label: `${daysLeft} days left`, colorClass: 'text-amber-400' }
  return { label: `${daysLeft} days left`, colorClass: 'text-green-400' }
}

// Mirrors the admin dashboard's last_service_date convention (stamped
// whenever a unit's status moves to Ready for Pickup). A unit
// currently checked in doesn't need a reminder - it's already being
// serviced - and one with no service history yet has nothing to measure
// from, so neither case shows the indicator.
function needsMaintenanceReminder(unit: { status: string; last_service_date: string | null }): boolean {
  if (ACTIVE_STATUSES.includes(unit.status)) return false
  if (!unit.last_service_date) return false
  const fourMonthsAgo = new Date()
  fourMonthsAgo.setMonth(fourMonthsAgo.getMonth() - 4)
  return new Date(unit.last_service_date) < fourMonthsAgo
}

function monthsSince(dateString: string): number {
  const then = new Date(dateString)
  const now = new Date()
  return (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth())
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

// A customer's written reply about a unit's diagnosis/quote - reuses the
// previously-unused messages table (scoped here via unit_id) rather than a
// new table. Not a full chat thread, just a way to leave a question or
// concern in writing before approving/denying.
type UnitReply = {
  id: string
  message: string
  created_at: string
  customer_name: string | null
  is_admin: boolean
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

const ACTIVE_STATUSES = [
  'Received',
  'Diagnosing',
  'Needs Approval',
  'In Repair',
  'Repair Requested',
  'Ready for Pickup',
]

// Fires the admin-facing push for an event this page just wrote to
// Supabase directly (client-side, under RLS) - the actual send needs the
// VAPID private key, which only the server route holds. Best-effort: the
// unit change itself already succeeded by the time this is called, so a
// failed/slow push here should never block or error out the customer's
// own flow.
function notifyAdminPush(event: 'service_request' | 'decision' | 'message', unitId: string, decision?: 'approve' | 'deny') {
  fetch('/api/push/notify-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, unitId, decision }),
  }).catch(() => {})
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
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null)
  const [serviceHistory, setServiceHistory] = useState<ServiceHistoryEntry[]>([])
  const [serviceHistoryLoading, setServiceHistoryLoading] = useState(false)
  const [unitPhotos, setUnitPhotos] = useState<UnitPhotoEntry[]>([])
  const [unitReplies, setUnitReplies] = useState<UnitReply[]>([])
  const [replyText, setReplyText] = useState('')
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

  // Private, customer-only reference note per unit (e.g. "hard time
  // starting") - lives in its own unit_customer_notes table with RLS that
  // grants only the owning customer access, so it's genuinely never
  // visible to the admin, not just hidden in the admin UI.
  const [privateNote, setPrivateNote] = useState('')
  const [privateNoteSavedNote, setPrivateNoteSavedNote] = useState('')
  const [privateNoteBusy, setPrivateNoteBusy] = useState(false)
  const [replyBusy, setReplyBusy] = useState(false)

  const [serial, setSerial] = useState('')
  const [model, setModel] = useState('')
  const [unitType, setUnitType] = useState('')
  const [customUnitType, setCustomUnitType] = useState('')
  const [unitTypeManuallySet, setUnitTypeManuallySet] = useState(false)
  const [hours, setHours] = useState('')
  const [problem, setProblem] = useState('')
  const [scheduled, setScheduled] = useState('')
  const [notes, setNotes] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)

  const [editNickname, setEditNickname] = useState('')
  const [editSerial, setEditSerial] = useState('')
  const [editModel, setEditModel] = useState('')
  const [editType, setEditType] = useState('')
  const [editCustomType, setEditCustomType] = useState('')
  const [editTypeManuallySet, setEditTypeManuallySet] = useState(false)
  const [editHours, setEditHours] = useState('')
  const [thumbFile, setThumbFile] = useState<File | null>(null)
  const [thumbPreview, setThumbPreview] = useState<string | null>(null)
  const [serviceNote, setServiceNote] = useState('')
  const [detailBusy, setDetailBusy] = useState(false)

  function handleModelChange(value: string) {
    const upper = value.toUpperCase()
    setModel(upper)
    if (unitTypeManuallySet) return
    const prefix = upper.trim().slice(0, 2)
    setUnitType(STIHL_PREFIX_MAP[prefix] || (upper.trim() ? 'Other' : ''))
  }

  function handleUnitTypeChange(value: string) {
    setUnitTypeManuallySet(true)
    setUnitType(value)
  }

  function handleEditModelChange(value: string) {
    const upper = value.toUpperCase()
    setEditModel(upper)
    if (editTypeManuallySet) return
    const prefix = upper.trim().slice(0, 2)
    setEditType(STIHL_PREFIX_MAP[prefix] || (upper.trim() ? 'Other' : ''))
  }

  function handleEditTypeChange(value: string) {
    setEditTypeManuallySet(true)
    setEditType(value)
  }

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

  async function uploadFile(file: File, prefix: string) {
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const fileName = `${prefix}-${Date.now()}-${safe}`
    const { error } = await supabase.storage
      .from('invoices')
      .upload(fileName, file, {
        contentType: file.type || 'image/jpeg',
        upsert: false,
      })
    if (error) throw error
    const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(fileName)
    return publicUrl
  }

  async function handleCheckIn(e: React.FormEvent) {
    e.preventDefault()
    if (!customer || !serial.trim()) return
    setSubmitting(true)
    setMessage(null)
    try {
      let photoUrl: string | null = null
      if (photoFile) photoUrl = await uploadFile(photoFile, customer.id)
      const createdAt = scheduled
        ? new Date(scheduled).toISOString()
        : new Date().toISOString()
      const finalUnitType = unitType === 'Other' && customUnitType.trim() ? customUnitType.trim() : unitType
      const trimmedSerial = serial.trim()

      // A unit already on this customer's fleet (same serial) gets linked
      // and its status updated instead of creating a second, duplicate row.
      // Skipped for placeholder serials ("Unknown", "N/A", ...) since those
      // aren't unique to one physical unit.
      let existingUnit: { id: string } | null = null
      if (isIdentifyingSerial(trimmedSerial)) {
        const { data: existingMatches } = await supabase
          .from('units')
          .select('id')
          .eq('customer_id', customer.id)
          .ilike('serial_number', escapeLikePattern(trimmedSerial))
          .order('created_at', { ascending: false })
          .limit(1)
        existingUnit = existingMatches?.[0] || null
      }

      const checkInFields = {
        serial_number: trimmedSerial,
        model: model.trim() || null,
        equipment_type: finalUnitType || null,
        hour_meter: unitType === 'Riding Lawn Mower' ? (hours.trim() || null) : null,
        problem_type: problem.trim() || null,
        notes: notes.trim() || null,
        notes_updated_at: new Date().toISOString(),
        status: 'Repair Requested',
        status_since: createdAt,
        decision_seen: true,
        archived: false,
        created_at: createdAt,
      }

      const { data: mutatedUnit, error } = existingUnit
        ? await supabase
            .from('units')
            .update({
              ...checkInFields,
              ...(photoUrl ? { photo_url: photoUrl, thumbnail_url: photoUrl } : {}),
            })
            .eq('id', existingUnit.id)
            .select('id')
            .single()
        : await supabase
            .from('units')
            .insert({
              ...checkInFields,
              photo_url: photoUrl,
              thumbnail_url: photoUrl,
              customer_id: customer.id,
            })
            .select('id')
            .single()
      if (error) {
        console.error(error)
        setMessage('Could not check in this unit. Let Jesse know if this keeps happening.')
        setSubmitting(false)
        return
      }
      notifyAdminPush('service_request', mutatedUnit.id)
      setSerial('')
      setModel('')
      setUnitType('')
      setCustomUnitType('')
      setUnitTypeManuallySet(false)
      setHours('')
      setProblem('')
      setScheduled('')
      setNotes('')
      setPhotoFile(null)
      setShowCheckIn(false)
      setMessage('Unit checked in. Jesse will see it shortly.')
      await loadData()
    } catch (err) {
      console.error(err)
      setMessage('Could not check in this unit. Let Jesse know if this keeps happening.')
    }
    setSubmitting(false)
  }

  function openUnit(unit: Unit) {
    setSelectedUnit(unit)
    setEditNickname(unit.nickname || '')
    setEditSerial(unit.serial_number || '')
    setEditModel(unit.model || '')
    setEditType(unit.equipment_type || '')
    setEditCustomType('')
    setEditTypeManuallySet(false)
    setEditHours(unit.hour_meter || '')
    setThumbFile(null)
    if (thumbPreview) URL.revokeObjectURL(thumbPreview)
    setThumbPreview(null)
    setServiceNote('')
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

    setUnitReplies([])
    setReplyText('')
    supabase
      .from('messages')
      .select('id, message, created_at, customer_name, is_admin')
      .eq('unit_id', unit.id)
      .order('created_at', { ascending: true })
      .then(({ data }) => setUnitReplies(data || []))

    setPrivateNote('')
    setPrivateNoteSavedNote('')
    supabase
      .from('unit_customer_notes')
      .select('notes')
      .eq('unit_id', unit.id)
      .maybeSingle()
      .then(({ data }) => {
        setPrivateNote(data?.notes || '')
        setPrivateNoteSavedNote(data?.notes || '')
      })
  }

  function closeUnit() {
    setSelectedUnit(null)
    setThumbFile(null)
    if (thumbPreview) URL.revokeObjectURL(thumbPreview)
    setThumbPreview(null)
    setServiceNote('')
    setServiceHistory([])
    setUnitPhotos([])
    setUnitReplies([])
    setReplyText('')
    setAskingQuestion(false)
    setPrivateNote('')
    setPrivateNoteSavedNote('')
  }

  async function savePrivateNote() {
    if (!selectedUnit) return
    setPrivateNoteBusy(true)
    const trimmed = privateNote.trim()
    const { error } = await supabase
      .from('unit_customer_notes')
      .upsert({ unit_id: selectedUnit.id, notes: trimmed || null, updated_at: new Date().toISOString() }, { onConflict: 'unit_id' })
    setPrivateNoteBusy(false)
    if (error) {
      console.error(error)
      setMessage('Could not save your private note.')
      return
    }
    setPrivateNoteSavedNote(trimmed)
    setMessage('Private note saved.')
  }

  // Scrolls the detail panel into view whenever a unit is opened, from any
  // section on the page (In Service, Fleet, or Other Units) - runs after
  // the panel has actually rendered for the newly-selected unit.
  useEffect(() => {
    if (selectedUnit?.id) {
      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [selectedUnit?.id])

  async function submitReply() {
    if (!selectedUnit || !customer || !replyText.trim()) return
    setReplyBusy(true)
    const { data, error } = await supabase
      .from('messages')
      .insert({
        unit_id: selectedUnit.id,
        customer_id: customer.id,
        customer_name: customer.name || userEmail || 'Customer',
        message: replyText.trim(),
      })
      .select('id, message, created_at, customer_name, is_admin')
      .single()
    setReplyBusy(false)
    if (error) {
      setMessage('Could not send your reply. Try again.')
      return
    }
    setUnitReplies(prev => [...prev, data])
    setReplyText('')
    notifyAdminPush('message', selectedUnit.id)
  }

  // "Ask a Question" on the Needs Approval prompt reuses this same
  // reply/message field (tied to the unit via unitReplies/submitReply)
  // rather than a separate mechanism - it just brings the existing field
  // into view and focus, and highlights it briefly.
  function askQuestion() {
    setAskingQuestion(true)
    replyInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    replyInputRef.current?.focus()
  }

  function onThumbPick(file: File | null) {
    setThumbFile(file)
    if (thumbPreview) URL.revokeObjectURL(thumbPreview)
    setThumbPreview(file ? URL.createObjectURL(file) : null)
  }

  async function saveUnitDetails() {
    if (!selectedUnit || !editSerial.trim()) {
      setMessage('Serial number is required.')
      return
    }
    setDetailBusy(true)
    const finalEditType = editType === 'Other' && editCustomType.trim() ? editCustomType.trim() : editType
    const finalEditHours = editType === 'Riding Lawn Mower' ? (editHours.trim() || null) : null
    const { error } = await supabase
      .from('units')
      .update({
        nickname: editNickname.trim() ? toTitleCase(editNickname) : null,
        serial_number: editSerial.trim(),
        model: editModel.trim() || null,
        equipment_type: finalEditType || null,
        hour_meter: finalEditHours,
      })
      .eq('id', selectedUnit.id)
    setDetailBusy(false)
    if (error) {
      console.error(error)
      setMessage('Could not save changes.')
      return
    }
    setMessage('Unit details saved.')
    await loadData()
    setSelectedUnit(prev =>
      prev
        ? {
            ...prev,
            nickname: editNickname.trim() ? toTitleCase(editNickname) : null,
            serial_number: editSerial.trim(),
            model: editModel.trim() || null,
            equipment_type: finalEditType || null,
            hour_meter: finalEditHours,
          }
        : null
    )
  }

  async function saveThumbnail() {
    if (!selectedUnit || !thumbFile) return
    setDetailBusy(true)
    try {
      const url = await uploadFile(thumbFile, `thumb-${selectedUnit.id}`)
      const { error } = await supabase
        .from('units')
        .update({ thumbnail_url: url })
        .eq('id', selectedUnit.id)
      if (error) throw error
      setMessage('Thumbnail updated.')
      onThumbPick(null)
      await loadData()
      setSelectedUnit(prev => prev ? { ...prev, thumbnail_url: url } : null)
    } catch (err) {
      console.error(err)
      setMessage('Could not upload thumbnail.')
    }
    setDetailBusy(false)
  }

  async function requestService() {
    if (!selectedUnit || !customer) return
    setDetailBusy(true)
    const name = customer.name || userEmail || 'Customer'
    const note = serviceNote.trim() || 'Customer requested tune-up / service'
    const historyLine = `${new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })} - Service requested by ${name}: ${note}`
    const { data: existing } = await supabase
      .from('units')
      .select('notes, history')
      .eq('id', selectedUnit.id)
      .single()
    const { error } = await supabase
      .from('units')
      .update({
        status: 'Repair Requested',
        status_since: new Date().toISOString(),
        problem_type: note,
        notes: existing?.notes ? `${note}\n${existing.notes}` : note,
        notes_updated_at: new Date().toISOString(),
        decision_seen: true,
        history: existing?.history ? `${historyLine}\n${existing.history}` : historyLine,
      })
      .eq('id', selectedUnit.id)
    setDetailBusy(false)
    if (error) {
      console.error(error)
      setMessage('Could not request service.')
      return
    }
    notifyAdminPush('service_request', selectedUnit.id)
    setMessage('Service requested. Jesse has been notified.')
    await loadData()
    closeUnit()
  }

  async function withdrawService() {
    if (!selectedUnit || !customer) return
    if (!confirm('Withdraw this service request? The unit will go back to your fleet list.')) return
    setDetailBusy(true)
    const name = customer.name || userEmail || 'Customer'
    const historyLine = `${new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })} - Service withdrawn by ${name} - returned to fleet`
    const { data: existing } = await supabase
      .from('units')
      .select('history')
      .eq('id', selectedUnit.id)
      .single()
    const { error } = await supabase
      .from('units')
      .update({
        status: 'Fleet',
        status_since: new Date().toISOString(),
        problem_type: null,
        decision_seen: true,
        history: existing?.history ? `${historyLine}\n${existing.history}` : historyLine,
      })
      .eq('id', selectedUnit.id)
    setDetailBusy(false)
    if (error) {
      console.error(error)
      setMessage('Could not withdraw service request.')
      return
    }
    setMessage('Service request withdrawn. Unit is back on your fleet list.')
    closeUnit()
    await loadData()
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

  const total = units.length
  const needsApproval = units.filter(u => u.status === 'Needs Approval').length
  const inProgress = units.filter(u =>
    ['Diagnosing', 'In Repair', 'Repair Requested', 'Received'].includes(u.status)
  ).length
  const completed = units.filter(u => u.status === 'Ready for Pickup').length

  // Stat tiles jump to a representative unit for their category, reusing
  // the same openUnit()/pin-to-top/scroll-into-view path as clicking a
  // card directly - when a category has more than one unit, the first
  // match is opened and the rest stay visible (pinned) in their section.
  const firstNeedsApproval = units.find(u => u.status === 'Needs Approval')
  const firstInProgress = units.find(u =>
    ['Diagnosing', 'In Repair', 'Repair Requested', 'Received'].includes(u.status)
  )
  const firstReadyForPickup = units.find(u => u.status === 'Ready for Pickup')

  const activeInvoices = invoices.filter(i => !i.paid_at)
  const archivedInvoices = invoices.filter(i => i.paid_at)
  function invoiceUnitLabel(inv: InvoiceRow) {
    const u = inv.unit_id ? units.find(u => u.id === inv.unit_id) : null
    if (!u) return null
    return u.nickname || [u.model, u.equipment_type].filter(Boolean).join(' - ') || null
  }

  function displayName(u: Unit) {
    const model = (u.model || '').trim()
    const type = (u.equipment_type || '').trim()
    if (model && type) return `${model} - ${type}`
    if (model) return model
    if (type) return type
    return u.nickname || u.serial_number || 'No model'
  }

  function UnitCard({ unit }: { unit: Unit }) {
    return (
      <button
        type="button"
        onClick={() => openUnit(unit)}
        className="w-full text-left bg-zinc-900 border border-zinc-800 hover:border-orange-500/50 rounded-xl p-3 flex gap-3 transition"
      >
        <UnitPhoto unit={unit} size="h-14 w-14 sm:h-16 sm:w-16" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-0.5">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <p className="font-semibold text-base sm:text-lg truncate">{displayName(unit)}</p>
              <span
                className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                  unit.status === 'Needs Approval'
                    ? 'bg-yellow-500/20 text-yellow-400'
                    : unit.status === 'Fleet'
                    ? 'bg-zinc-600 text-gray-300'
                    : unit.status === 'Ready for Pickup'
                    ? 'bg-green-500/20 text-green-400'
                    : unit.status === 'In Repair'
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'bg-orange-500/20 text-orange-400'
                }`}
              >
                {unit.status}
              </span>
              {unit.diagnosis_notes && (
                <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-orange-500/20 text-orange-300">
                  Diagnosis Updated
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-zinc-700 text-gray-300">
                Serial: {unit.serial_number || '-'}
              </span>
              <WarrantyShieldIcon underWarranty={isUnderWarranty(unit)} />
            </div>
          </div>
          {(() => {
            const countdown = warrantyCountdown(unit.warranty_end)
            if (!countdown) return null
            return (
              <p className={`text-xs ${countdown.colorClass}`}>
                Warranty: {countdown.label} (ends {formatShortDate(unit.warranty_end)})
              </p>
            )
          })()}
          {(unit.nickname || unit.hour_meter) && (
            <p className="text-sm text-gray-400">
              {unit.nickname || ''}
              {unit.nickname && unit.hour_meter ? ' - ' : ''}
              {unit.hour_meter ? `${unit.hour_meter} hrs` : ''}
            </p>
          )}
          {unit.problem_type && unit.status !== 'Fleet' && (
            <p className="text-sm text-gray-500 mt-0.5">Problem: {unit.problem_type}</p>
          )}
          {unit.status === 'Needs Approval' && (
            <p className="text-xs text-yellow-400 mt-1">Tap to approve or decide {'->'}</p>
          )}
          {unit.status === 'Fleet' && (
            <p className="text-xs text-gray-500 mt-1">Tap to edit or schedule service {'->'}</p>
          )}
          {(unit.status === 'Repair Requested' || unit.status === 'Received' || unit.status === 'Diagnosing') && (
            <p className="text-xs text-gray-500 mt-1">Tap to view or withdraw service {'->'}</p>
          )}
        </div>
      </button>
    )
  }

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
        {/* Loud, animated banner above everything else when a decision is
            waiting - the "Needs Approval" stat tile below is easy to miss
            among three other equal-looking tiles (see animate-approval-pulse
            in globals.css for why). Redundant with that tile on purpose -
            this is the thing that's supposed to be impossible to miss, not
            a replacement for the other ways to get there. */}
        {needsApproval > 0 && firstNeedsApproval && (
          <button
            type="button"
            onClick={() => openUnit(firstNeedsApproval)}
            className="w-full flex items-center justify-between gap-3 bg-red-600 hover:bg-red-500 text-white rounded-xl px-4 py-3.5 sm:py-4 shadow-lg shadow-red-900/50 animate-approval-pulse transition"
          >
            <span className="flex items-center gap-2.5 min-w-0 text-left">
              <span className="text-2xl shrink-0" aria-hidden="true">⚠️</span>
              <span className="min-w-0">
                <span className="block font-bold text-base sm:text-lg leading-tight">
                  {needsApproval === 1 ? '1 Repair Needs Your Approval' : `${needsApproval} Repairs Need Your Approval`}
                </span>
                <span className="block text-xs sm:text-sm text-red-100">Tap here to review and approve</span>
              </span>
            </span>
            <span className="text-2xl shrink-0" aria-hidden="true">{'->'}</span>
          </button>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => unitsTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="bg-zinc-900 border border-zinc-800 hover:border-zinc-600 rounded-xl p-3 text-left transition"
          >
            <p className="text-xs text-gray-500 uppercase">Total Units</p>
            <p className="text-2xl font-bold text-orange-400">{total}</p>
          </button>
          <button
            type="button"
            onClick={() => firstNeedsApproval && openUnit(firstNeedsApproval)}
            disabled={!firstNeedsApproval}
            className={`rounded-xl p-3 text-left transition ${
              needsApproval > 0
                ? 'bg-red-500/10 border border-red-500/50 hover:border-red-400'
                : 'bg-zinc-900 border border-zinc-800 cursor-default'
            }`}
          >
            <p className={`text-xs uppercase ${needsApproval > 0 ? 'text-red-400' : 'text-gray-500'}`}>Needs Approval</p>
            <p className={`text-2xl font-bold ${needsApproval > 0 ? 'text-red-400' : 'text-yellow-400'}`}>{needsApproval}</p>
          </button>
          <button
            type="button"
            onClick={() => firstInProgress && openUnit(firstInProgress)}
            disabled={!firstInProgress}
            className={`rounded-xl p-3 text-left transition ${
              inProgress > 0
                ? 'bg-blue-500/10 border border-blue-500/40 hover:border-blue-400'
                : 'bg-zinc-900 border border-zinc-800 cursor-default'
            }`}
          >
            <p className={`text-xs uppercase ${inProgress > 0 ? 'text-blue-400' : 'text-gray-500'}`}>In Progress</p>
            <p className="text-2xl font-bold text-blue-400">{inProgress}</p>
          </button>
          <button
            type="button"
            onClick={() => firstReadyForPickup && openUnit(firstReadyForPickup)}
            disabled={!firstReadyForPickup}
            className={`rounded-xl p-3 text-left transition ${
              completed > 0
                ? 'bg-green-500/10 border border-green-500/40 hover:border-green-400'
                : 'bg-zinc-900 border border-zinc-800 cursor-default'
            }`}
          >
            <p className={`text-xs uppercase ${completed > 0 ? 'text-green-400' : 'text-gray-500'}`}>Ready for Pickup</p>
            <p className="text-2xl font-bold text-green-400">{completed}</p>
          </button>
        </div>

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

        {(showActiveInvoices || showArchivedInvoices) && (() => {
          const list = showActiveInvoices ? activeInvoices : archivedInvoices
          return (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <div className="px-4 sm:px-6 py-3 border-b border-zinc-800">
                <h2 className="text-lg font-semibold text-orange-400">
                  {showActiveInvoices ? 'Active Invoices' : 'Archive'}
                </h2>
                <p className="text-xs text-gray-500 mt-1">
                  {showActiveInvoices
                    ? 'Anything still unpaid, most recent first.'
                    : 'Your paid invoice history, for your own records/taxes.'}
                </p>
              </div>
              <div className="p-3 sm:p-4 space-y-1.5">
                {list.length === 0 ? (
                  <p className="text-gray-500 text-sm px-1">
                    {showActiveInvoices ? "You're all caught up - nothing outstanding." : 'No paid invoices yet.'}
                  </p>
                ) : (
                  list.map(inv => {
                    const label = invoiceUnitLabel(inv)
                    return (
                      <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 bg-zinc-800/40 border border-zinc-800 rounded-lg px-3 py-2 text-sm">
                        <div>
                          <span className="font-medium">{inv.invoice_number || 'Invoice'}</span>
                          <span className="text-gray-500"> - {new Date(inv.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                          {label && <span className="text-gray-500"> - {label}</span>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-medium">${Number(inv.amount).toFixed(2)}</span>
                          {inv.paid_at ? (
                            <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-green-500/20 text-green-400">Paid</span>
                          ) : (
                            <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-yellow-500/20 text-yellow-400">Unpaid</span>
                          )}
                          {inv.pdf_url && (
                            <a
                              href={inv.pdf_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs border border-zinc-600 hover:border-orange-500 text-white font-medium px-2.5 py-1 rounded-lg transition"
                            >
                              View PDF
                            </a>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )
        })()}

        {showMyFleet && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-4 sm:px-6 py-3 border-b border-zinc-800">
              <h2 className="text-lg font-semibold text-orange-400">My Fleet</h2>
              <p className="text-xs text-gray-500 mt-1">
                Every unit on your account, active or not - keep your serial numbers on hand in case a unit is ever lost or stolen and you need to report it.
              </p>
            </div>
            {units.length === 0 ? (
              <p className="px-4 sm:px-6 py-5 text-gray-500 text-sm">No units on your account yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-zinc-800">
                      <th className="px-4 sm:px-6 py-3">Model</th>
                      <th className="px-3 py-3">Category</th>
                      <th className="px-3 py-3">Serial Number</th>
                      <th className="px-3 py-3">Status</th>
                      <th className="px-3 py-3">Maintenance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {[...units]
                      .sort((a, b) => (a.model || a.nickname || '').localeCompare(b.model || b.nickname || ''))
                      .map(unit => (
                        <tr
                          key={unit.id}
                          onClick={() => openUnit(unit)}
                          className={`cursor-pointer hover:bg-zinc-800/40 transition ${
                            unit.status === 'Needs Approval' ? 'bg-red-500/10 border-l-4 border-l-red-500' : ''
                          }`}
                        >
                          <td className="px-4 sm:px-6 py-3 font-medium">
                            <div className="flex flex-wrap items-center gap-2">
                              {unit.status === 'Needs Approval' && (
                                <span className="inline-flex items-center gap-1 shrink-0 text-xs px-2 py-0.5 rounded-full font-bold bg-red-600 text-white">
                                  <span className="h-1.5 w-1.5 rounded-full bg-white" />
                                  Action Needed
                                </span>
                              )}
                              <span>{unit.model || '-'}</span>
                            </div>
                            {unit.nickname && (
                              <span className="block text-xs text-gray-500 font-normal">{unit.nickname}</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-gray-300">{unit.equipment_type || '-'}</td>
                          <td className="px-3 py-3 font-mono text-orange-300">{unit.serial_number || '-'}</td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className={`inline-block text-xs px-2.5 py-1 rounded-full font-medium ${
                                unit.status === 'Needs Approval' ? 'bg-yellow-500/20 text-yellow-400'
                                  : unit.status === 'Fleet' ? 'bg-zinc-600 text-gray-300'
                                  : unit.status === 'Ready for Pickup' ? 'bg-green-500/20 text-green-400'
                                  : unit.status === 'In Repair' ? 'bg-blue-500/20 text-blue-400'
                                  : 'bg-orange-500/20 text-orange-400'
                              }`}>{unit.status}</span>
                              {isUnderWarranty(unit) && (
                                <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-blue-500/20 text-blue-400">
                                  Under Warranty
                                </span>
                              )}
                            </div>
                            <span className="block text-xs text-gray-500 mt-1">
                              {ACTIVE_STATUSES.includes(unit.status) ? 'In for service' : 'With you'}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            {needsMaintenanceReminder(unit) ? (
                              <div
                                className="inline-flex flex-col"
                                title="It's been a while since this unit's last service. Regular maintenance helps avoid bigger, costlier repairs down the road."
                              >
                                <span className="inline-flex items-center gap-1.5 w-fit text-xs px-2.5 py-1 rounded-full font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
                                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                                  Checkup Recommended
                                </span>
                                <span className="text-xs text-gray-500 mt-1">
                                  {monthsSince(unit.last_service_date!)}+ months since last service
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-gray-600">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5">
            <h2 className="text-lg font-semibold text-orange-400 mb-1">Check In a Unit</h2>
            <p className="text-sm text-gray-500 mb-4">
              Tell us what's coming in. Jesse can correct any details after pickup.
            </p>
            <form onSubmit={handleCheckIn} className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Model</label>
                <input
                  value={model}
                  onChange={e => handleModelChange(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  placeholder="e.g. MS 462"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Serial Number *</label>
                <input
                  required
                  value={serial}
                  onChange={e => setSerial(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Unit Type</label>
                <select
                  value={unitType}
                  onChange={e => handleUnitTypeChange(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select equipment type</option>
                  {EQUIPMENT_CATEGORIES.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                {unitType === 'Other' && (
                  <input
                    value={customUnitType}
                    onChange={e => setCustomUnitType(e.target.value)}
                    placeholder="Describe equipment type (e.g. battery unit)"
                    className="mt-2 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  />
                )}
              </div>
              {unitType === 'Riding Lawn Mower' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Hour meter (optional)</label>
                  <input
                    value={hours}
                    onChange={e => setHours(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                    placeholder="e.g. 142.5"
                    inputMode="decimal"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs text-gray-500 mb-1">What's wrong</label>
                <input
                  value={problem}
                  onChange={e => setProblem(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  placeholder="Won't start, tune-up, etc."
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Scheduled drop-off (optional)</label>
                <input
                  type="datetime-local"
                  value={scheduled}
                  onChange={e => setScheduled(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Photo of unit / serial plate</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={e => setPhotoFile(e.target.files?.[0] || null)}
                  className="w-full text-sm text-gray-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-orange-600 file:text-white"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Notes</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  placeholder="Anything else we should know..."
                />
              </div>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-orange-600 hover:bg-orange-500 disabled:opacity-60 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition"
                >
                  {submitting ? 'Checking in...' : 'Check In Unit'}
                </button>
              </div>
            </form>
          </div>
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
                  <p className="font-semibold text-lg truncate">{displayName(selectedUnit)}</p>
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
              <div className="border-t border-zinc-800 pt-3">
                <label className="block text-xs text-gray-500 mb-1">
                  Private Notes <span className="text-zinc-600">(only visible to you, not Jesse)</span>
                </label>
                <textarea
                  value={privateNote}
                  onChange={e => setPrivateNote(e.target.value)}
                  rows={2}
                  placeholder="e.g. This unit has a hard time starting..."
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                />
                <button
                  onClick={savePrivateNote}
                  disabled={privateNoteBusy || privateNote === privateNoteSavedNote}
                  className="mt-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
                >
                  {privateNoteBusy ? 'Saving...' : 'Save Private Note'}
                </button>
              </div>
            )}

            {canEditDetails && (
              <div className="space-y-3 border-t border-zinc-800 pt-3">
                <p className="text-sm font-medium text-orange-300">Edit unit details</p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Model</label>
                    <input
                      value={editModel}
                      onChange={e => handleEditModelChange(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Serial Number *</label>
                    <input
                      value={editSerial}
                      onChange={e => setEditSerial(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Unit Type</label>
                    <select
                      value={editType}
                      onChange={e => handleEditTypeChange(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">Select equipment type</option>
                      {EQUIPMENT_CATEGORIES.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    {editType === 'Other' && (
                      <input
                        value={editCustomType}
                        onChange={e => setEditCustomType(e.target.value)}
                        placeholder="Describe equipment type (e.g. battery unit)"
                        className="mt-2 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Nickname</label>
                    <input
                      value={editNickname}
                      onChange={e => setEditNickname(liveTitleCase(e.target.value))}
                      placeholder="e.g. Shop mower #2"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  {editType === 'Riding Lawn Mower' && (
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">Hour meter</label>
                      <input
                        value={editHours}
                        onChange={e => setEditHours(e.target.value)}
                        placeholder="e.g. 142.5"
                        inputMode="decimal"
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                  )}
                </div>
                <button
                  onClick={saveUnitDetails}
                  disabled={detailBusy}
                  className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
                >
                  {detailBusy ? 'Saving...' : 'Save Details'}
                </button>
              </div>
            )}

            <div className="border-t border-zinc-800 pt-3">
              <label className="block text-xs text-gray-500 mb-1">Unit thumbnail photo</label>
              <p className="text-xs text-gray-600 mb-2">Update this any time - e.g. after you&apos;ve cleaned it up.</p>
              <div className="flex flex-col gap-3">
                {thumbPreview && (
                  <img
                    src={thumbPreview}
                    alt="New thumbnail preview"
                    className="h-24 w-24 object-cover rounded-lg border border-orange-500/50"
                  />
                )}
                <label className="inline-flex items-center justify-center bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg cursor-pointer w-full sm:w-auto">
                  {thumbFile ? 'Choose Different Photo' : 'Choose Photo'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => onThumbPick(e.target.files?.[0] || null)}
                  />
                </label>
                {thumbFile && (
                  <button
                    onClick={saveThumbnail}
                    disabled={detailBusy}
                    className="bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg w-full sm:w-auto"
                  >
                    {detailBusy ? 'Uploading...' : 'Save Thumbnail'}
                  </button>
                )}
              </div>
            </div>

            {canEditDetails && (
              <div className="border-t border-zinc-800 pt-3">
                <label className="block text-xs text-gray-500 mb-1">Request service / tune-up</label>
                <input
                  value={serviceNote}
                  onChange={e => setServiceNote(e.target.value)}
                  placeholder="e.g. Due for 3-month tune-up..."
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm mb-2"
                />
                <button
                  onClick={requestService}
                  disabled={detailBusy}
                  className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
                >
                  Schedule Service
                </button>
              </div>
            )}

            {(selectedUnit.status === 'Repair Requested' || selectedUnit.status === 'Received' || selectedUnit.status === 'Diagnosing') && (
              <div className="border-t border-zinc-800 pt-3">
                <button
                  onClick={withdrawService}
                  disabled={detailBusy}
                  className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
                >
                  Withdraw Service {'->'} Back to Fleet
                </button>
              </div>
            )}

            {selectedUnit.status === 'Needs Approval' ? (
              // One unified card while a decision is pending - previously
              // this was two separately-styled, stacked boxes (a Diagnosis
              // Notes card and a "Repair decision needed" card) that
              // largely repeated the same diagnosis text/estimate link,
              // reading as disconnected. Now every piece of the decision -
              // findings, photos, the number, and the actions - lives in
              // one card.
              <div className="border border-yellow-500/30 rounded-xl bg-yellow-500/10 p-3 sm:p-4 space-y-3">
                <p className="text-xs text-yellow-400 uppercase tracking-wider">Repair decision needed</p>

                {selectedUnit.diagnosis_notes ? (
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-bold text-orange-300">Diagnosis Notes</p>
                      {selectedUnit.diagnosis_notes_updated_at && (
                        <span className="text-xs text-orange-400 bg-orange-500/10 border border-orange-500/30 rounded-full px-2 py-0.5">
                          Updated {formatShortDate(selectedUnit.diagnosis_notes_updated_at)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-200 whitespace-pre-wrap">{selectedUnit.diagnosis_notes}</p>
                  </div>
                ) : (
                  <p className="text-sm text-gray-200">
                    {selectedUnit.notes || 'Jesse has a repair recommendation for this unit.'}
                  </p>
                )}

                {selectedUnit.diagnosis_notes && selectedUnit.notes && (
                  <div>
                    <p className="text-sm font-bold text-blue-300 mb-1">Your Reported Issue</p>
                    <p className="text-sm text-blue-100 whitespace-pre-wrap">{selectedUnit.notes}</p>
                  </div>
                )}

                {(() => {
                  const diagnosisMedia = unitPhotos.filter(p => p.stage === 'diagnosis')
                  if (diagnosisMedia.length === 0) return null
                  const shown = diagnosisMedia.slice(0, 4)
                  const remaining = diagnosisMedia.length - shown.length
                  return (
                    <div className="flex flex-wrap items-center gap-2">
                      <UnitPhotoGallery
                        size="sm"
                        photos={shown.map(p => ({ id: p.id, url: p.url, caption: p.caption, mediaType: p.media_type }))}
                        onPhotoClick={p => setLightboxMedia({ url: p.url, isVideo: p.mediaType === 'video', caption: p.caption ?? null })}
                      />
                      {remaining > 0 && (
                        <span className="text-xs text-gray-500">+{remaining} more</span>
                      )}
                    </div>
                  )
                })()}

                {invoiceTotals[selectedUnit.id] != null && (
                  <p className="text-sm font-bold text-yellow-300">
                    Estimate total: ${invoiceTotals[selectedUnit.id].toFixed(2)}
                  </p>
                )}
                {/* invoicePdfUrls (the actual generated invoice, read straight
                    from the invoices table) takes priority over the older
                    units.invoice_url - that field needs a separate manual
                    upload step to ever get set, so relying on it alone left
                    this link missing on an otherwise perfectly normal
                    generated invoice. Styled as a real button, same weight
                    as Approve/Deny below - a judgment call needs the actual
                    line-itemized invoice in front of someone, not a small
                    underlined link easy to scroll past. */}
                {(invoicePdfUrls[selectedUnit.id] || selectedUnit.invoice_url) && (
                  <a
                    href={invoicePdfUrls[selectedUnit.id] || selectedUnit.invoice_url || undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg"
                  >
                    📄 View Full Invoice (PDF) {'->'}
                  </a>
                )}

                <div className="space-y-2">
                  <p className="text-xs text-gray-500 uppercase tracking-wider">
                    {unitReplies.length > 0 ? 'Messages' : 'Have a question about this?'}
                  </p>
                  {unitReplies.map(r => (
                    <div
                      key={r.id}
                      className={`border rounded-lg px-3 py-2 ${
                        r.is_admin ? 'bg-orange-500/10 border-orange-500/30' : 'bg-zinc-800/60 border-zinc-700'
                      }`}
                    >
                      <p className="text-xs text-gray-500">
                        {r.is_admin ? 'Savage Chainsaws' : 'You'} -{' '}
                        {new Date(r.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </p>
                      <p className="text-sm text-gray-200 whitespace-pre-wrap mt-0.5">{r.message}</p>
                    </div>
                  ))}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      ref={replyInputRef}
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      placeholder="Ask a question about the diagnosis or quote..."
                      className={`flex-1 bg-zinc-800 border rounded-lg px-3 py-2 text-sm ${
                        askingQuestion ? 'border-orange-500 ring-1 ring-orange-500/50' : 'border-zinc-700'
                      }`}
                    />
                    <button
                      onClick={submitReply}
                      disabled={replyBusy || !replyText.trim()}
                      className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg shrink-0"
                    >
                      {replyBusy ? 'Sending...' : 'Send Reply'}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    onClick={() => handleDecision(selectedUnit.id, 'approve')}
                    className="bg-green-600 hover:bg-green-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('Deny this repair? A $49.99 diagnosis fee will be charged.')) {
                        handleDecision(selectedUnit.id, 'deny')
                      }
                    }}
                    className="bg-red-700 hover:bg-red-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
                  >
                    Deny ($49.99 diag)
                  </button>
                  <button
                    onClick={askQuestion}
                    className="bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
                  >
                    Ask a Question
                  </button>
                </div>
              </div>
            ) : (
              selectedUnit.diagnosis_notes && (
                <div className="border border-orange-500/30 rounded-xl bg-orange-500/[0.03] p-3 sm:p-4 space-y-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-bold text-orange-300">Diagnosis Notes</p>
                      {selectedUnit.diagnosis_notes_updated_at && (
                        <span className="text-xs text-orange-400 bg-orange-500/10 border border-orange-500/30 rounded-full px-2 py-0.5">
                          Updated {formatShortDate(selectedUnit.diagnosis_notes_updated_at)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-200 whitespace-pre-wrap">{selectedUnit.diagnosis_notes}</p>
                  </div>

                  {selectedUnit.notes && (
                    <div>
                      <p className="text-sm font-bold text-blue-300 mb-1">Your Reported Issue</p>
                      <p className="text-sm text-blue-100 whitespace-pre-wrap">{selectedUnit.notes}</p>
                    </div>
                  )}

                  {(invoicePdfUrls[selectedUnit.id] || selectedUnit.invoice_url) && (
                    <a
                      href={invoicePdfUrls[selectedUnit.id] || selectedUnit.invoice_url || undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block text-sm text-orange-400 hover:text-orange-300 underline"
                    >
                      View Estimate / Quote (PDF) {'->'}
                    </a>
                  )}

                  {(() => {
                    const diagnosisMedia = unitPhotos.filter(p => p.stage === 'diagnosis')
                    if (diagnosisMedia.length === 0) return null
                    return (
                      <div className="space-y-2">
                        {/* Deliberately loud - easy to overlook as plain text,
                            so it gets the same highlighted-box treatment as
                            the admin side. */}
                        <div className="flex items-center gap-2 bg-orange-500/15 border border-orange-500/40 rounded-lg px-3 py-2.5">
                          <span className="text-sm font-bold text-orange-300 uppercase tracking-wide">
                            Diagnosis Findings - Photos &amp; Videos
                          </span>
                          <span className="text-xs bg-orange-500 text-black font-bold rounded-full px-2 py-0.5">{diagnosisMedia.length}</span>
                        </div>
                        <UnitPhotoGallery
                          photos={diagnosisMedia.map(p => ({ id: p.id, url: p.url, caption: p.caption, mediaType: p.media_type }))}
                        />
                      </div>
                    )
                  })()}

                  <div className="space-y-2">
                    <p className="text-xs text-gray-500 uppercase tracking-wider">
                      {unitReplies.length > 0 ? 'Messages' : 'Have a question about this?'}
                    </p>
                    {unitReplies.map(r => (
                      <div
                        key={r.id}
                        className={`border rounded-lg px-3 py-2 ${
                          r.is_admin ? 'bg-orange-500/10 border-orange-500/30' : 'bg-zinc-800/60 border-zinc-700'
                        }`}
                      >
                        <p className="text-xs text-gray-500">
                          {r.is_admin ? 'Savage Chainsaws' : 'You'} -{' '}
                          {new Date(r.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </p>
                        <p className="text-sm text-gray-200 whitespace-pre-wrap mt-0.5">{r.message}</p>
                      </div>
                    ))}
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        ref={replyInputRef}
                        value={replyText}
                        onChange={e => setReplyText(e.target.value)}
                        placeholder="Ask a question about the diagnosis or quote..."
                        className={`flex-1 bg-zinc-800 border rounded-lg px-3 py-2 text-sm ${
                          askingQuestion ? 'border-orange-500 ring-1 ring-orange-500/50' : 'border-zinc-700'
                        }`}
                      />
                      <button
                        onClick={submitReply}
                        disabled={replyBusy || !replyText.trim()}
                        className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg shrink-0"
                      >
                        {replyBusy ? 'Sending...' : 'Send Reply'}
                      </button>
                    </div>
                  </div>
                </div>
              )
            )}

            <div className="border-t border-zinc-800 pt-3">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Photos</p>
              {(() => {
                const photos = [
                  ...(selectedUnit.photo_url
                    ? [{ id: 'checkin', url: selectedUnit.photo_url, caption: 'Check-in photo', deletable: false }]
                    : []),
                  ...unitPhotos.filter(p => p.stage === 'checkin'),
                ]
                return photos.length === 0 ? (
                  <p className="text-xs text-gray-500">No photos yet.</p>
                ) : (
                  <UnitPhotoGallery photos={photos} />
                )
              })()}
              {(() => {
                const beforePhotos = [
                  ...(selectedUnit.photo_url
                    ? [{ id: 'checkin-primary', url: selectedUnit.photo_url, label: formatShortDate(selectedUnit.created_at) }]
                    : []),
                  ...unitPhotos
                    .filter(p => p.stage === 'checkin')
                    .map(p => ({ id: p.id, url: p.url, label: p.caption || formatShortDate(p.created_at) })),
                ]
                const afterPhotos = unitPhotos
                  .filter(p => p.stage === 'diagnosis' && p.media_type !== 'video')
                  .map(p => ({ id: p.id, url: p.url, label: p.caption || formatShortDate(p.created_at) }))
                return <BeforeAfterCompare beforePhotos={beforePhotos} afterPhotos={afterPhotos} />
              })()}
            </div>

            <div className="border-t border-zinc-800 pt-3">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Service History</p>
              {serviceHistoryLoading ? (
                <p className="text-xs text-gray-500">Loading...</p>
              ) : serviceHistory.length === 0 ? (
                <p className="text-xs text-gray-500">
                  No completed service logged yet for this unit.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {serviceHistory.map(e => (
                    <div key={e.id} className="flex flex-wrap items-start gap-2 text-sm bg-zinc-950/60 border border-zinc-800 rounded-lg px-3 py-2">
                      <span className="text-gray-500 w-24 shrink-0">{formatShortDate(e.service_date)}</span>
                      <span className="text-gray-300 flex-1 min-w-[140px]">{e.description}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

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
                  <UnitCard key={unit.id} unit={unit} />
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
              fleetUnits.map(unit => <UnitCard key={unit.id} unit={unit} />)
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
              otherUnits.map(unit => <UnitCard key={unit.id} unit={unit} />)
            )}
          </div>
        </details>

        <SiteFooter />
      </div>
    </main>
  )
}

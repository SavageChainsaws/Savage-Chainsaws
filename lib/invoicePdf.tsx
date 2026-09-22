import { Document, Page, View, Text, Image as PdfImage, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { CARD_SURCHARGE_DISCLOSURE, LABOR_ONLY_NOTE } from './billing'

const BUSINESS = {
  name: 'Savage Chainsaws',
  legalName: 'Savage Chainsaws LLC',
  ein: '33-3410708',
  website: 'savagechainsaws.com',
  email: 'service@savagechainsaws.com',
  phone: '(407) 375-8199',
  address: '260 Roosevelt Square',
  addressLine2: 'Oviedo, FL 32765',
}

// Matches the app's Tailwind brand palette (orange-600 accent on a dark
// zinc ground) so the PDF reads as the same product, not a generic form.
const BRAND = {
  orange: '#ea580c',
  orangeTint: '#fdf1e9',
  dark: '#1c1917',
  border: '#e5e5e5',
  boxBg: '#fafafa',
  muted: '#666666',
}

// Same fallback a customer's brand_color gets everywhere else it's used
// (the customer-group divider on the admin dashboard) - keeps an
// unbranded customer's Bill To box from looking unstyled/broken.
const DEFAULT_ACCENT = BRAND.orange

const styles = StyleSheet.create({
  page: { padding: 0, fontSize: 10, fontFamily: 'Helvetica', color: '#1a1a1a' },
  topBar: { height: 6, backgroundColor: BRAND.orange },
  body: { paddingHorizontal: 32, paddingTop: 18, paddingBottom: 24 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  logo: { width: 100, height: 100, objectFit: 'contain', marginRight: 14 },
  headerRight: { alignItems: 'flex-end' },
  wordmark: { fontSize: 21, fontWeight: 700, color: BRAND.dark, letterSpacing: 0.5, textAlign: 'right' },
  wordmarkAccent: { color: BRAND.orange },
  invoiceTitle: { fontSize: 11, color: BRAND.muted, textTransform: 'uppercase', letterSpacing: 2, marginTop: 2, textAlign: 'right' },
  // Savage's own business info, printed compact right under the wordmark
  // rather than a full-width box - the itemized work and the customer's
  // own info are what should dominate the page below this. Still boxed
  // (matching Bill To's treatment) but sized to its own content instead
  // of spanning the page.
  fromBox: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
    marginTop: 8,
    border: `1 solid ${BRAND.border}`,
    borderRadius: 6,
    padding: 8,
  },
  fromAccentBar: { height: 3, width: 60, borderRadius: 2, marginBottom: 5, backgroundColor: BRAND.orange, alignSelf: 'flex-end' },
  fromCompactName: { fontSize: 9.5, fontWeight: 700, color: BRAND.dark, textAlign: 'right' },
  fromCompactLine: { fontSize: 8, color: BRAND.muted, textAlign: 'right', marginTop: 1 },

  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: BRAND.dark,
    borderRadius: 4,
  },
  metaLabel: { fontSize: 7.5, color: '#bbbbbb', textTransform: 'uppercase', letterSpacing: 0.5 },
  metaValue: { fontSize: 11, fontWeight: 700, color: '#ffffff', marginTop: 1 },

  box: {
    border: `1 solid ${BRAND.border}`,
    borderRadius: 6,
    padding: 9,
    marginBottom: 8,
  },
  boxAccentBar: { height: 3, borderRadius: 2, marginBottom: 6 },
  boxTitle: {
    fontSize: 7.5,
    color: BRAND.muted,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  boxLine: { fontSize: 9.5, color: '#333333', marginBottom: 1.5, lineHeight: 1.3 },
  boxNameLine: { fontSize: 11.5, fontWeight: 700, color: BRAND.dark, marginBottom: 2 },

  billToLogoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  billToLogo: { width: 28, height: 28, objectFit: 'contain', marginRight: 7, borderRadius: 4 },

  unitBox: {
    border: `1 solid ${BRAND.border}`,
    borderRadius: 6,
    padding: 8,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  unitThumb: { width: 36, height: 36, objectFit: 'cover', borderRadius: 4, marginRight: 10 },
  unitNickname: { fontSize: 10.5, fontWeight: 700, color: BRAND.dark },

  sectionDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  sectionLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: BRAND.orange,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginRight: 8,
  },
  sectionRule: { flex: 1, borderTop: `1 solid ${BRAND.border}` },

  table: { marginTop: 0, marginBottom: 4 },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: BRAND.orange,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 2,
  },
  tableRow: { flexDirection: 'row', paddingVertical: 4.5, paddingHorizontal: 8, borderBottom: `1 solid ${BRAND.border}` },
  colDescription: { flex: 1 },
  colAmount: { width: 80, textAlign: 'right' },
  tableHeaderText: { fontSize: 8, color: '#ffffff', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 },
  descriptionText: { fontSize: 10 },
  skuLine: { fontSize: 7.5, color: BRAND.muted, marginTop: 1 },

  // Audit-trail note for a labor-only invoice (Fla. Admin. Code
  // 12A-1.006 exemption) and the card-surcharge disclosure - both plain,
  // one-line notes printed above the totals block rather than inside it,
  // so neither reads as part of the itemized math.
  noteLine: { fontSize: 8.5, color: BRAND.muted, marginTop: 4, textAlign: 'right' },
  laborOnlyNote: { fontSize: 9, fontWeight: 700, color: BRAND.orange, marginTop: 4, textAlign: 'right' },

  totalsRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },
  totalsBlock: {
    width: 220,
    border: `1 solid ${BRAND.orange}`,
    backgroundColor: BRAND.orangeTint,
    borderRadius: 4,
    padding: 9,
  },
  grandTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  grandTotalLabel: { fontSize: 10.5, fontWeight: 700, color: BRAND.dark },
  grandTotalValue: { fontSize: 15, fontWeight: 700, color: BRAND.orange },

  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 8.5,
    color: '#ffffff',
    backgroundColor: BRAND.dark,
    paddingVertical: 7,
  },
})

function money(n: number): string {
  return n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`
}

// sku is optional and only ever set for a tracked unit's Parts line items,
// matched against that unit's resolved model parts/overrides (see
// app/api/invoice/route.ts) - the custom/free-form invoice has no unit
// record to resolve parts from, so its line items never carry one.
export type InvoiceLineItem = { description: string; amount: number; sku?: string | null }

export type InvoicePdfInput = {
  invoiceNumber: string
  invoiceDate: string
  customer: {
    name: string
    email?: string | null
    phone?: string | null
    // The same brand-color/logo a customer can set on their own portal
    // (reused from the customer-group divider on the admin dashboard) -
    // shown here so a recognizable, professional "Bill To" appears for
    // customers who have one on file, with a clean fallback to plain
    // contact info for those who don't.
    logoUrl?: string | null
    brandColor?: string | null
  }
  unit?: {
    model?: string | null
    serialNumber?: string | null
    equipmentType?: string | null
    // Shown alongside model/serial as extra identification when on file -
    // nickname helps a customer recognize "their" saw at a glance, and the
    // thumbnail mirrors the small preview already used throughout the app.
    nickname?: string | null
    thumbnailUrl?: string | null
  } | null
  lineItems: InvoiceLineItem[]
  // Savage Chainsaws' own logo - kept as an input (rather than hardcoded)
  // so the API routes control the absolute URL, same as before.
  logoUrl?: string | null
  // Set whenever the invoice has no parts/materials line items at all - the
  // audit-trail note the FL sales-tax exemption (Fla. Admin. Code
  // 12A-1.006) relies on for a labor-only invoice. See lib/billing.ts.
  laborOnlyNote?: boolean
  // Set whenever a card-processing-fee line was added - the disclosure the
  // surcharge requires, printed near the totals since this PDF has no
  // payment button of its own (that only lives in the invoice email).
  showCardSurchargeDisclosure?: boolean
}

function InvoiceDocument({
  invoiceNumber,
  invoiceDate,
  customer,
  unit,
  lineItems,
  logoUrl,
  laborOnlyNote,
  showCardSurchargeDisclosure,
}: InvoicePdfInput) {
  const grandTotal = lineItems.reduce((sum, li) => sum + li.amount, 0)
  const hasUnit = !!unit && (unit.model || unit.serialNumber || unit.equipmentType || unit.nickname || unit.thumbnailUrl)
  const customerAccent = customer.brandColor || DEFAULT_ACCENT

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.topBar} />
        <View style={styles.body}>
          <View style={styles.headerRow}>
            {logoUrl ? <PdfImage src={logoUrl} style={styles.logo} /> : <View />}
            <View style={styles.headerRight}>
              <Text style={styles.wordmark}>
                SAVAGE <Text style={styles.wordmarkAccent}>CHAINSAWS</Text>
              </Text>
              <Text style={styles.invoiceTitle}>Invoice</Text>

              {/* Savage's own legal/contact info, kept compact under the
                  wordmark - boxed to match Bill To's treatment, but sized
                  to its own content rather than spanning the page, since
                  the customer's info and the actual work done are what
                  should fill the rest of it. */}
              <View style={styles.fromBox}>
                <View style={styles.fromAccentBar} />
                <Text style={styles.boxTitle}>From</Text>
                <Text style={styles.fromCompactName}>{BUSINESS.legalName}</Text>
                <Text style={styles.fromCompactLine}>
                  {BUSINESS.address}, {BUSINESS.addressLine2}
                </Text>
                <Text style={styles.fromCompactLine}>EIN {BUSINESS.ein}</Text>
                <Text style={styles.fromCompactLine}>
                  {BUSINESS.phone}  ·  {BUSINESS.email}  ·  {BUSINESS.website}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.metaRow}>
            <View>
              <Text style={styles.metaLabel}>Invoice Number</Text>
              <Text style={styles.metaValue}>{invoiceNumber}</Text>
            </View>
            <View>
              <Text style={styles.metaLabel}>Invoice Date</Text>
              <Text style={styles.metaValue}>{invoiceDate}</Text>
            </View>
          </View>

          <View style={styles.box}>
            <View style={[styles.boxAccentBar, { backgroundColor: customerAccent }]} />
            <Text style={styles.boxTitle}>Bill To</Text>
            {customer.logoUrl ? (
              <View style={styles.billToLogoRow}>
                <PdfImage src={customer.logoUrl} style={styles.billToLogo} />
                <Text style={styles.boxNameLine}>{customer.name}</Text>
              </View>
            ) : (
              <Text style={styles.boxNameLine}>{customer.name}</Text>
            )}
            {customer.email && <Text style={styles.boxLine}>{customer.email}</Text>}
            {customer.phone && <Text style={styles.boxLine}>{customer.phone}</Text>}
          </View>

          {hasUnit && unit && (
            <View style={styles.unitBox}>
              {unit.thumbnailUrl && <PdfImage src={unit.thumbnailUrl} style={styles.unitThumb} />}
              <View>
                {unit.nickname && <Text style={styles.unitNickname}>{unit.nickname}</Text>}
                <Text style={styles.boxLine}>
                  {[unit.model, unit.equipmentType].filter(Boolean).join(' - ') || 'Unit'}
                  {unit.serialNumber ? `  ·  Serial: ${unit.serialNumber}` : ''}
                </Text>
              </View>
            </View>
          )}

          <View style={styles.sectionDivider}>
            <Text style={styles.sectionLabel}>Services &amp; Parts</Text>
            <View style={styles.sectionRule} />
          </View>

          <View style={styles.table}>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.tableHeaderText, styles.colDescription]}>Description</Text>
              <Text style={[styles.tableHeaderText, styles.colAmount]}>Amount</Text>
            </View>

            {lineItems.map((li, i) => (
              <View key={i} style={styles.tableRow}>
                <View style={styles.colDescription}>
                  <Text style={styles.descriptionText}>{li.description}</Text>
                  {li.sku && <Text style={styles.skuLine}>SKU: {li.sku}</Text>}
                </View>
                <Text style={styles.colAmount}>{money(li.amount)}</Text>
              </View>
            ))}
          </View>

          {laborOnlyNote && <Text style={styles.laborOnlyNote}>{LABOR_ONLY_NOTE}</Text>}
          {showCardSurchargeDisclosure && <Text style={styles.noteLine}>{CARD_SURCHARGE_DISCLOSURE}</Text>}

          <View style={styles.totalsRow}>
            <View style={styles.totalsBlock}>
              <View style={styles.grandTotalRow}>
                <Text style={styles.grandTotalLabel}>Grand Total</Text>
                <Text style={styles.grandTotalValue}>{money(grandTotal)}</Text>
              </View>
            </View>
          </View>
        </View>

        <Text style={styles.footer}>Thank you for choosing Savage Chainsaws!</Text>
      </Page>
    </Document>
  )
}

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument {...input} />)
}

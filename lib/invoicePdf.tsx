import { Document, Page, View, Text, Image as PdfImage, StyleSheet, renderToBuffer } from '@react-pdf/renderer'

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
// unbranded customer's Bill To box from looking unstyled/broken next to
// Savage's own orange-accented From box.
const DEFAULT_ACCENT = BRAND.orange

const styles = StyleSheet.create({
  page: { padding: 0, fontSize: 10, fontFamily: 'Helvetica', color: '#1a1a1a' },
  topBar: { height: 8, backgroundColor: BRAND.orange },
  body: { padding: 36, paddingTop: 28 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  logo: { width: 150, height: 150, objectFit: 'contain', marginRight: 16 },
  wordmark: { fontSize: 24, fontWeight: 700, color: BRAND.dark, letterSpacing: 0.5 },
  wordmarkAccent: { color: BRAND.orange },
  invoiceTitle: { fontSize: 13, color: BRAND.muted, textTransform: 'uppercase', letterSpacing: 2, marginTop: 4 },

  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: BRAND.dark,
    borderRadius: 4,
  },
  metaLabel: { fontSize: 8, color: '#bbbbbb', textTransform: 'uppercase', letterSpacing: 0.5 },
  metaValue: { fontSize: 12, fontWeight: 700, color: '#ffffff', marginTop: 2 },

  twoCol: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  box: {
    flex: 1,
    border: `1 solid ${BRAND.border}`,
    borderRadius: 6,
    padding: 12,
  },
  boxAccentBar: { height: 4, borderRadius: 2, marginBottom: 9 },
  boxTitle: {
    fontSize: 8,
    color: BRAND.muted,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  boxLine: { fontSize: 9.5, color: '#333333', marginBottom: 2, lineHeight: 1.4 },
  boxNameLine: { fontSize: 12, fontWeight: 700, color: BRAND.dark, marginBottom: 3 },
  legalDivider: { borderTop: `1 solid ${BRAND.border}`, marginTop: 6, marginBottom: 6 },
  einLine: { fontSize: 8, color: '#888888', marginTop: 1 },

  billToLogoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  billToLogo: { width: 32, height: 32, objectFit: 'contain', marginRight: 8, borderRadius: 4 },

  unitBox: {
    border: `1 solid ${BRAND.border}`,
    borderRadius: 6,
    padding: 12,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  unitThumb: { width: 44, height: 44, objectFit: 'cover', borderRadius: 4, marginRight: 12 },
  unitNickname: { fontSize: 11, fontWeight: 700, color: BRAND.dark },

  sectionDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
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
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 2,
  },
  tableRow: { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 8, borderBottom: `1 solid ${BRAND.border}` },
  colDescription: { flex: 1 },
  colAmount: { width: 80, textAlign: 'right' },
  tableHeaderText: { fontSize: 8, color: '#ffffff', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 },
  partLine: { fontSize: 9, color: '#666666', paddingHorizontal: 8, paddingVertical: 2 },

  totalsRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 18 },
  totalsBlock: {
    width: 240,
    border: `1 solid ${BRAND.orange}`,
    backgroundColor: BRAND.orangeTint,
    borderRadius: 4,
    padding: 12,
  },
  grandTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  grandTotalLabel: { fontSize: 11, fontWeight: 700, color: BRAND.dark },
  grandTotalValue: { fontSize: 16, fontWeight: 700, color: BRAND.orange },

  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 9,
    color: '#ffffff',
    backgroundColor: BRAND.dark,
    paddingVertical: 10,
  },
})

function money(n: number): string {
  return `$${n.toFixed(2)}`
}

export type InvoiceLineItem = { description: string; amount: number }

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
  // Informational only - the resolved Parts & SKUs list for a tracked unit,
  // printed under the line items as reference. Not used by the custom/
  // free-form invoice, which has no unit record to resolve parts from.
  parts?: { name: string; sku: string }[]
  // Savage Chainsaws' own logo - kept as an input (rather than hardcoded)
  // so the API routes control the absolute URL, same as before.
  logoUrl?: string | null
}

function InvoiceDocument({ invoiceNumber, invoiceDate, customer, unit, lineItems, parts, logoUrl }: InvoicePdfInput) {
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
            <View>
              <Text style={styles.wordmark}>
                SAVAGE <Text style={styles.wordmarkAccent}>CHAINSAWS</Text>
              </Text>
              <Text style={styles.invoiceTitle}>Invoice</Text>
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

          <View style={styles.twoCol}>
            <View style={styles.box}>
              <View style={[styles.boxAccentBar, { backgroundColor: BRAND.orange }]} />
              <Text style={styles.boxTitle}>From</Text>
              <Text style={styles.boxNameLine}>{BUSINESS.legalName}</Text>
              <Text style={styles.boxLine}>{BUSINESS.address}</Text>
              <Text style={styles.boxLine}>{BUSINESS.addressLine2}</Text>
              <Text style={styles.einLine}>EIN {BUSINESS.ein}</Text>
              <View style={styles.legalDivider} />
              <Text style={styles.boxLine}>{BUSINESS.phone}</Text>
              <Text style={styles.boxLine}>{BUSINESS.email}</Text>
              <Text style={styles.boxLine}>{BUSINESS.website}</Text>
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
                <Text style={styles.colDescription}>{li.description}</Text>
                <Text style={styles.colAmount}>{money(li.amount)}</Text>
              </View>
            ))}

            {parts && parts.length > 0 && (
              <View>
                {parts.map((p, i) => (
                  <Text key={i} style={styles.partLine}>- {p.name} ({p.sku})</Text>
                ))}
              </View>
            )}
          </View>

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

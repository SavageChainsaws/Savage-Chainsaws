import { Document, Page, View, Text, Image as PdfImage, StyleSheet, renderToBuffer } from '@react-pdf/renderer'

const BUSINESS = {
  name: 'Savage Chainsaws',
  website: 'savagechainsaws.com',
  email: 'service@savagechainsaws.com',
  phone: '(407) 375-8199',
  address: '1607 South Orlando Ave, Maitland, FL 32751',
}

// Matches the app's Tailwind brand palette (orange-600 accent on a dark
// zinc ground) so the PDF reads as the same product, not a generic form.
const BRAND = {
  orange: '#ea580c',
  orangeTint: '#fdf1e9',
  dark: '#1c1917',
}

const styles = StyleSheet.create({
  page: { padding: 0, fontSize: 10, fontFamily: 'Helvetica', color: '#1a1a1a' },
  topBar: { height: 8, backgroundColor: BRAND.orange },
  body: { padding: 36, paddingTop: 24 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  logo: { width: 96, height: 96, objectFit: 'contain' },
  businessBlock: { alignItems: 'flex-end', textAlign: 'right' },
  businessName: { fontSize: 18, fontWeight: 700, color: BRAND.orange, marginBottom: 3 },
  businessLine: { fontSize: 9, color: '#444444' },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
    paddingBottom: 10,
    paddingTop: 2,
    borderBottom: `2 solid ${BRAND.orange}`,
  },
  metaLabel: { fontSize: 8, color: '#888888', textTransform: 'uppercase', letterSpacing: 0.5 },
  metaValue: { fontSize: 11, fontWeight: 700, marginTop: 2 },
  twoCol: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  block: { width: '48%' },
  blockTitle: {
    fontSize: 8,
    color: BRAND.orange,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 5,
    paddingBottom: 3,
    borderBottom: '1 solid #eeeeee',
  },
  blockLine: { fontSize: 10, marginBottom: 2 },
  unitIdRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  unitThumb: { width: 40, height: 40, objectFit: 'cover', borderRadius: 4, marginRight: 8 },
  unitNickname: { fontSize: 11, fontWeight: 700, color: BRAND.dark },
  table: { marginTop: 4, marginBottom: 4 },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: BRAND.orange,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 2,
  },
  tableRow: { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 8, borderBottom: '1 solid #eeeeee' },
  colDescription: { flex: 1 },
  colAmount: { width: 80, textAlign: 'right' },
  tableHeaderText: { fontSize: 8, color: '#ffffff', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 },
  partLine: { fontSize: 9, color: '#666666', paddingHorizontal: 8, paddingVertical: 2 },
  totalsBlock: {
    marginTop: 14,
    alignSelf: 'flex-end',
    width: 240,
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
  customer: { name: string; email?: string | null; phone?: string | null }
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
  logoUrl?: string | null
}

function InvoiceDocument({ invoiceNumber, invoiceDate, customer, unit, lineItems, parts, logoUrl }: InvoicePdfInput) {
  const grandTotal = lineItems.reduce((sum, li) => sum + li.amount, 0)
  const hasUnit = !!unit && (unit.model || unit.serialNumber || unit.equipmentType || unit.nickname || unit.thumbnailUrl)

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.topBar} />
        <View style={styles.body}>
          <View style={styles.headerRow}>
            {logoUrl ? <PdfImage src={logoUrl} style={styles.logo} /> : <View />}
            <View style={styles.businessBlock}>
              <Text style={styles.businessName}>{BUSINESS.name}</Text>
              <Text style={styles.businessLine}>{BUSINESS.website}</Text>
              <Text style={styles.businessLine}>{BUSINESS.email}</Text>
              <Text style={styles.businessLine}>{BUSINESS.phone}</Text>
              <Text style={styles.businessLine}>{BUSINESS.address}</Text>
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
            <View style={styles.block}>
              <Text style={styles.blockTitle}>Bill To</Text>
              <Text style={styles.blockLine}>{customer.name}</Text>
              {customer.email && <Text style={styles.blockLine}>{customer.email}</Text>}
              {customer.phone && <Text style={styles.blockLine}>{customer.phone}</Text>}
            </View>
            {hasUnit && unit && (
              <View style={styles.block}>
                <Text style={styles.blockTitle}>Unit</Text>
                <View style={styles.unitIdRow}>
                  {unit.thumbnailUrl && <PdfImage src={unit.thumbnailUrl} style={styles.unitThumb} />}
                  <View>
                    {unit.nickname && <Text style={styles.unitNickname}>{unit.nickname}</Text>}
                    {unit.model && <Text style={styles.blockLine}>{unit.model}</Text>}
                  </View>
                </View>
                {unit.serialNumber && <Text style={styles.blockLine}>Serial: {unit.serialNumber}</Text>}
                {unit.equipmentType && <Text style={styles.blockLine}>{unit.equipmentType}</Text>}
              </View>
            )}
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

          <View style={styles.totalsBlock}>
            <View style={styles.grandTotalRow}>
              <Text style={styles.grandTotalLabel}>Grand Total</Text>
              <Text style={styles.grandTotalValue}>{money(grandTotal)}</Text>
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

import { Document, Page, View, Text, Image as PdfImage, StyleSheet, renderToBuffer } from '@react-pdf/renderer'

const BUSINESS = {
  name: 'Savage Chainsaws',
  website: 'savagechainsaws.com',
  email: 'service@savagechainsaws.com',
  phone: '(407) 375-8199',
  address: '1607 South Orlando Ave, Maitland, FL 32751',
}

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: 'Helvetica', color: '#1a1a1a' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  logo: { width: 64, height: 64, objectFit: 'contain' },
  businessBlock: { alignItems: 'flex-end', textAlign: 'right' },
  businessName: { fontSize: 16, fontWeight: 700, color: '#ea580c', marginBottom: 2 },
  businessLine: { fontSize: 9, color: '#444444' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18, paddingBottom: 10, borderBottom: '1 solid #dddddd' },
  metaLabel: { fontSize: 8, color: '#888888', textTransform: 'uppercase', letterSpacing: 0.5 },
  metaValue: { fontSize: 11, fontWeight: 700, marginTop: 2 },
  twoCol: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  block: { width: '48%' },
  blockTitle: { fontSize: 8, color: '#888888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  blockLine: { fontSize: 10, marginBottom: 2 },
  customerLogo: { width: 36, height: 36, objectFit: 'contain', marginBottom: 6 },
  table: { marginTop: 4, marginBottom: 4 },
  tableHeaderRow: { flexDirection: 'row', backgroundColor: '#f4f4f4', paddingVertical: 6, paddingHorizontal: 8 },
  tableRow: { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 8, borderBottom: '1 solid #eeeeee' },
  colDescription: { flex: 1 },
  colAmount: { width: 80, textAlign: 'right' },
  tableHeaderText: { fontSize: 8, color: '#888888', textTransform: 'uppercase', letterSpacing: 0.5 },
  partLine: { fontSize: 9, color: '#666666', paddingHorizontal: 8, paddingVertical: 2 },
  totalsBlock: { marginTop: 8, alignSelf: 'flex-end', width: 220 },
  grandTotalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, marginTop: 4, borderTop: '1 solid #1a1a1a' },
  grandTotalLabel: { fontSize: 11, fontWeight: 700 },
  grandTotalValue: { fontSize: 13, fontWeight: 700, color: '#ea580c' },
  footer: { position: 'absolute', bottom: 36, left: 36, right: 36, textAlign: 'center', fontSize: 9, color: '#888888', borderTop: '1 solid #eeeeee', paddingTop: 10 },
})

function money(n: number): string {
  return `$${n.toFixed(2)}`
}

export type InvoiceLineItem = { description: string; amount: number }

export type InvoicePdfInput = {
  invoiceNumber: string
  invoiceDate: string
  customer: { name: string; email?: string | null; phone?: string | null; logoUrl?: string | null }
  unit?: { model?: string | null; serialNumber?: string | null; equipmentType?: string | null } | null
  lineItems: InvoiceLineItem[]
  // Informational only - the resolved Parts & SKUs list for a tracked unit,
  // printed under the line items as reference. Not used by the custom/
  // free-form invoice, which has no unit record to resolve parts from.
  parts?: { name: string; sku: string }[]
  logoUrl?: string | null
}

function InvoiceDocument({ invoiceNumber, invoiceDate, customer, unit, lineItems, parts, logoUrl }: InvoicePdfInput) {
  const grandTotal = lineItems.reduce((sum, li) => sum + li.amount, 0)

  return (
    <Document>
      <Page size="A4" style={styles.page}>
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
            {/* Customer-uploaded logo, if any - never a placeholder when absent */}
            {customer.logoUrl ? <PdfImage src={customer.logoUrl} style={styles.customerLogo} /> : null}
            <Text style={styles.blockLine}>{customer.name}</Text>
            {customer.email && <Text style={styles.blockLine}>{customer.email}</Text>}
            {customer.phone && <Text style={styles.blockLine}>{customer.phone}</Text>}
          </View>
          {unit && (unit.model || unit.serialNumber || unit.equipmentType) && (
            <View style={styles.block}>
              <Text style={styles.blockTitle}>Unit</Text>
              {unit.model && <Text style={styles.blockLine}>{unit.model}</Text>}
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

        <Text style={styles.footer}>Thank you for choosing Savage Chainsaws!</Text>
      </Page>
    </Document>
  )
}

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument {...input} />)
}

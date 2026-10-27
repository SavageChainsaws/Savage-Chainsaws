import { Document, Page, View, Text, Image as PdfImage, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import type { AgreementUnit, RateType } from './multiUnitRentalAgreement'
import { RATE_PER_UNIT_PER_DAY, RATE_PER_UNIT_THREE_DAY_PACKAGE, DEPOSIT_PER_UNIT, LATE_FEE_PER_UNIT_PER_DAY } from './multiUnitRentalAgreement'

const BUSINESS = {
  legalName: 'Savage Chainsaws',
  address: '260 Roosevelt Sq, Oviedo, FL 32765',
  phone: '(407) 375-8199',
  email: 'service@savagechainsaws.com',
}

const BRAND = { orange: '#ea580c', dark: '#1c1917', border: '#cccccc', muted: '#444444' }

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: 'Helvetica', color: '#1a1a1a' },
  topBar: { height: 4, backgroundColor: BRAND.orange, marginBottom: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  logo: { width: 56, height: 56, objectFit: 'contain', marginRight: 12 },
  title: { fontSize: 16, fontWeight: 700, color: BRAND.dark },
  contactLine: { fontSize: 8.5, color: BRAND.muted, marginTop: 2 },
  noticeBar: { backgroundColor: BRAND.dark, color: '#ffffff', fontSize: 8.5, paddingVertical: 4, paddingHorizontal: 8, marginBottom: 8 },

  sectionTitle: { fontSize: 10, fontWeight: 700, color: BRAND.orange, marginTop: 8, marginBottom: 3 },
  line: { fontSize: 9, color: '#1a1a1a', marginBottom: 2, lineHeight: 1.35 },
  fieldInline: { fontWeight: 700 },

  table: { marginTop: 4, marginBottom: 4, border: `1 solid ${BRAND.border}` },
  tableRow: { flexDirection: 'row' },
  tableHeaderCell: { flex: 1, fontSize: 8, fontWeight: 700, backgroundColor: '#f2f2f2', padding: 4, borderRight: `1 solid ${BRAND.border}`, borderBottom: `1 solid ${BRAND.border}` },
  tableCell: { flex: 1, fontSize: 8.5, padding: 4, borderRight: `1 solid ${BRAND.border}`, borderTop: `1 solid ${BRAND.border}` },

  termTitle: { fontSize: 9, fontWeight: 700, color: BRAND.dark, marginTop: 5, marginBottom: 1.5 },
  termBody: { fontSize: 8.3, color: '#262626', lineHeight: 1.35 },

  signatureRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  signatureBlock: { width: '46%' },
  signatureImg: { width: 160, height: 44, objectFit: 'contain', marginBottom: 2 },
  signatureLine: { borderTop: `1 solid ${BRAND.dark}`, paddingTop: 3 },
  signatureLabel: { fontSize: 8, color: BRAND.muted },

  footer: { fontSize: 7.5, color: '#999999', textAlign: 'center', marginTop: 16 },
})

function fmtDate(d: string | null): string {
  if (!d) return '______________'
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function fmtDateTime(d: string | null): string {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function money(n: number): string {
  return `$${n.toFixed(2)}`
}

export type MultiUnitRentalAgreementPdfInput = {
  agreementReference: string
  agreementDate: string
  renter: { name: string; phone: string | null; email: string | null }
  units: AgreementUnit[]
  rentalStart: string
  dueBack: string
  rateType: RateType
  rentalFee: number
  depositAmount: number
  depositReceived: number | null
  paymentMethod: string | null
  renterSignatureUrl?: string | null
  renterSignedAt?: string | null
  ownerSignatureUrl?: string | null
  ownerSignedAt?: string | null
  logoUrl?: string | null
}

function MultiUnitRentalAgreementDocument(input: MultiUnitRentalAgreementPdfInput) {
  const {
    agreementReference, agreementDate, renter, units, rentalStart, dueBack, rateType,
    rentalFee, depositAmount, depositReceived, paymentMethod,
    renterSignatureUrl, renterSignedAt, ownerSignatureUrl, ownerSignedAt, logoUrl,
  } = input
  const rateLabel = rateType === 'daily'
    ? `${money(RATE_PER_UNIT_PER_DAY)} per unit per day`
    : `${money(RATE_PER_UNIT_THREE_DAY_PACKAGE)} per unit (three days' charge)`

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.topBar} />
        <View style={styles.headerRow}>
          {logoUrl && <PdfImage src={logoUrl} style={styles.logo} />}
          <View>
            <Text style={styles.title}>Chainsaw Equipment Rental Agreement</Text>
            <Text style={styles.contactLine}>
              {BUSINESS.legalName} | {BUSINESS.address} | {BUSINESS.phone} | {BUSINESS.email}
            </Text>
            <Text style={styles.contactLine}>Agreement # {agreementReference} - {fmtDate(agreementDate)}</Text>
          </View>
        </View>
        <Text style={styles.noticeBar}>Equipment rental agreement. Please read carefully before signing.</Text>

        <Text style={styles.sectionTitle}>1. Parties and Equipment</Text>
        <Text style={styles.line}>
          This agreement is between <Text style={styles.fieldInline}>Savage Chainsaws</Text> (&quot;Owner&quot;) and the person named below (&quot;Renter&quot;).
        </Text>
        <Text style={styles.line}>
          Renter name: <Text style={styles.fieldInline}>{renter.name}</Text>
          {'   '}Phone: <Text style={styles.fieldInline}>{renter.phone || '-'}</Text>
          {'   '}Email: <Text style={styles.fieldInline}>{renter.email || '-'}</Text>
        </Text>

        <View style={styles.table}>
          <View style={styles.tableRow}>
            <Text style={[styles.tableHeaderCell, { flex: 0.4 }]}>Unit</Text>
            <Text style={styles.tableHeaderCell}>Model</Text>
            <Text style={styles.tableHeaderCell}>Serial #</Text>
            <Text style={[styles.tableHeaderCell, { borderRight: 'none' }]}>Condition at Pickup</Text>
          </View>
          {units.map((u, i) => (
            <View style={styles.tableRow} key={i}>
              <Text style={[styles.tableCell, { flex: 0.4 }]}>{i + 1}</Text>
              <Text style={styles.tableCell}>{u.model}</Text>
              <Text style={styles.tableCell}>{u.serialNumber || '-'}</Text>
              <Text style={[styles.tableCell, { borderRight: 'none' }]}>{u.conditionAtPickup || '-'}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>2. Term and Rates</Text>
        <Text style={styles.line}>
          Rental start: <Text style={styles.fieldInline}>{fmtDate(rentalStart)}</Text>
          {'   '}Due back: <Text style={styles.fieldInline}>{fmtDate(dueBack)}</Text>.
          {' '}Rate: <Text style={styles.fieldInline}>{rateLabel}</Text>.
          {' '}Refundable security deposit: <Text style={styles.fieldInline}>{money(DEPOSIT_PER_UNIT)} per unit</Text>, due at pickup.
          {' '}Late return: {money(LATE_FEE_PER_UNIT_PER_DAY)} per unit per day after the due date.
        </Text>

        <Text style={styles.termTitle}>3. Fuel and Proper Use</Text>
        <Text style={styles.termBody}>
          Renter will use only 50:1 premium gasoline mixed with 2-stroke oil. Straight gasoline or any other fuel is prohibited. Renter is
          solely responsible for proper and safe use of the equipment, including felling, cutting, chain tension, bar and chain care,
          handling, and personal protective equipment. Renter will follow the owner&apos;s manual and all safety instructions, and will not
          lend or sublet the equipment to anyone.
        </Text>

        <Text style={styles.termTitle}>4. Renter Assumes All Responsibility</Text>
        <Text style={styles.termBody}>
          Renter assumes full responsibility for the equipment from pickup until it is returned, including any misuse, unsafe operation or
          handling, improper fuel, neglect, impact damage, overheating, and any other damage, whatever the cause. Renter will pay for
          repair of any damage, including parts and labor, up to a maximum of 75% of the current STIHL USA retail price of the damaged
          unit (new), which is the most Renter will pay for repair. Retail price is determined as of the date of damage.
        </Text>

        <Text style={styles.termTitle}>5. Loss or Theft</Text>
        <Text style={styles.termBody}>
          If equipment is lost, stolen, or cannot be returned, Renter will pay the replacement cost of that unit, equal to 75% of the
          current STIHL USA retail price of that unit (new), determined as of the date of loss. Owner may apply the security deposit
          toward this amount.
        </Text>

        <Text style={styles.termTitle}>6. Release and Indemnity</Text>
        <Text style={styles.termBody}>
          To the fullest extent permitted by Florida law, Renter releases Savage Chainsaws and its owner from all claims, losses,
          injuries, and damages arising from the use, handling, or possession of the equipment, and agrees to indemnify and hold Owner
          harmless from any third-party claims arising from Renter&apos;s use. Renter acknowledges that chainsaws are inherently dangerous
          and that Owner does not provide training or supervision. This release does not apply to Owner&apos;s gross negligence or
          intentional wrongdoing, or to any rights that cannot be waived under Florida law.
        </Text>

        <Text style={styles.termTitle}>7. Return and Late Fees</Text>
        <Text style={styles.termBody}>
          Equipment must be returned clean, with the same parts and accessories as at pickup, with the tank drained or fuel left as at
          pickup. Late returns incur the late fee in Section 2 for each day past due, and Renter remains responsible for rental charges
          until the equipment is returned.
        </Text>

        <Text style={styles.termTitle}>8. Entire Agreement</Text>
        <Text style={styles.termBody}>
          This agreement is the entire agreement and is governed by Florida law. If any provision is unenforceable, the rest remains in
          effect.
        </Text>
        <Text style={styles.termBody}>
          Renter has read this agreement, understands it, and agrees to it, including Sections 3 through 6.
        </Text>

        <View style={styles.signatureRow} wrap={false}>
          <View style={styles.signatureBlock}>
            {renterSignatureUrl && <PdfImage src={renterSignatureUrl} style={styles.signatureImg} />}
            <View style={styles.signatureLine}>
              <Text style={styles.signatureLabel}>
                Renter signature{renterSignatureUrl ? '' : ' / Date'}
                {renterSignatureUrl && renterSignedAt ? ` - ${fmtDateTime(renterSignedAt)}` : ''}
              </Text>
            </View>
          </View>
          <View style={styles.signatureBlock}>
            {ownerSignatureUrl && <PdfImage src={ownerSignatureUrl} style={styles.signatureImg} />}
            <View style={styles.signatureLine}>
              <Text style={styles.signatureLabel}>
                Owner signature{ownerSignatureUrl ? '' : ' / Date'}
                {ownerSignatureUrl && ownerSignedAt ? ` - ${fmtDateTime(ownerSignedAt)}` : ''}
              </Text>
            </View>
          </View>
        </View>

        <Text style={[styles.line, { marginTop: 10 }]}>
          Deposit received: <Text style={styles.fieldInline}>{depositReceived != null ? money(depositReceived) : money(depositAmount)}</Text>
          {'   '}Rental fee: <Text style={styles.fieldInline}>{money(rentalFee)}</Text>
          {'   '}Payment method: <Text style={styles.fieldInline}>{paymentMethod || '-'}</Text>
        </Text>

        <Text style={styles.footer}>Savage Chainsaws - Rental Agreement {agreementReference}</Text>
      </Page>
    </Document>
  )
}

export async function renderMultiUnitRentalAgreementPdf(input: MultiUnitRentalAgreementPdfInput): Promise<Buffer> {
  return renderToBuffer(<MultiUnitRentalAgreementDocument {...input} />)
}

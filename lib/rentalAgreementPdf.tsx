import { Document, Page, View, Text, Image as PdfImage, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { rentalAgreementTerms } from './rentals'

const BUSINESS = {
  legalName: 'Savage Chainsaws LLC',
  email: 'service@savagechainsaws.com',
  phone: '(407) 375-8199',
  address: '260 Roosevelt Square',
  addressLine2: 'Oviedo, FL 32765',
}

const BRAND = {
  orange: '#ea580c',
  orangeTint: '#fdf1e9',
  dark: '#1c1917',
  border: '#e5e5e5',
  muted: '#666666',
  warnBg: '#fff4e5',
  warnBorder: '#ea580c',
}

const styles = StyleSheet.create({
  page: { padding: 0, fontSize: 9, fontFamily: 'Helvetica', color: '#1a1a1a' },
  topBar: { height: 6, backgroundColor: BRAND.orange },
  body: { paddingHorizontal: 32, paddingTop: 16, paddingBottom: 12 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  logo: { width: 70, height: 70, objectFit: 'contain', marginRight: 14 },
  headerRight: { alignItems: 'flex-end' },
  wordmark: { fontSize: 17, fontWeight: 700, color: BRAND.dark, letterSpacing: 0.5, textAlign: 'right' },
  wordmarkAccent: { color: BRAND.orange },
  docTitle: { fontSize: 10, color: BRAND.muted, textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 2, textAlign: 'right' },
  fromLine: { fontSize: 8, color: BRAND.muted, textAlign: 'right', marginTop: 6 },

  metaRow: {
    flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8,
    paddingVertical: 6, paddingHorizontal: 12, backgroundColor: BRAND.dark, borderRadius: 4,
  },
  metaLabel: { fontSize: 7, color: '#bbbbbb', textTransform: 'uppercase', letterSpacing: 0.5 },
  metaValue: { fontSize: 10, fontWeight: 700, color: '#ffffff', marginTop: 1 },

  box: { border: `1 solid ${BRAND.border}`, borderRadius: 6, padding: 8, marginBottom: 8 },
  boxAccentBar: { height: 3, borderRadius: 2, marginBottom: 5, backgroundColor: BRAND.orange },
  boxTitle: { fontSize: 7, color: BRAND.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
  fieldRow: { flexDirection: 'row', flexWrap: 'wrap' },
  field: { width: '50%', marginBottom: 3 },
  fieldLabel: { fontSize: 7, color: BRAND.muted },
  fieldValue: { fontSize: 9.5, fontWeight: 700, color: BRAND.dark },

  sectionDivider: { flexDirection: 'row', alignItems: 'center', marginTop: 6, marginBottom: 5 },
  sectionLabel: { fontSize: 8.5, fontWeight: 700, color: BRAND.orange, textTransform: 'uppercase', letterSpacing: 1, marginRight: 8 },
  sectionRule: { flex: 1, borderTop: `1 solid ${BRAND.border}` },

  termBlock: { marginBottom: 5 },
  termTitle: { fontSize: 8.5, fontWeight: 700, color: BRAND.dark, marginBottom: 1.5 },
  termLine: { fontSize: 8, color: '#333333', marginBottom: 1, lineHeight: 1.3 },

  warnBox: { backgroundColor: BRAND.warnBg, border: `1.5 solid ${BRAND.warnBorder}`, borderRadius: 6, padding: 9, marginTop: 4, marginBottom: 8 },
  warnTitle: { fontSize: 9, fontWeight: 700, color: BRAND.orange, marginBottom: 3 },
  warnLine: { fontSize: 8.5, color: BRAND.dark, lineHeight: 1.3 },

  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  photo: { width: 90, height: 68, objectFit: 'cover', borderRadius: 4, marginRight: 6, marginBottom: 6, border: `1 solid ${BRAND.border}` },
  emptyNote: { fontSize: 8, color: BRAND.muted, fontStyle: 'italic', marginTop: 2 },

  chargesTable: { marginTop: 4, marginBottom: 4 },
  chargeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  chargeLabel: { fontSize: 8.5, color: '#333333' },
  chargeValue: { fontSize: 8.5, color: '#333333' },
  totalsRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6 },
  totalsBlock: { width: 220, border: `1 solid ${BRAND.orange}`, backgroundColor: BRAND.orangeTint, borderRadius: 4, padding: 8 },
  grandTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  grandTotalLabel: { fontSize: 9.5, fontWeight: 700, color: BRAND.dark },
  grandTotalValue: { fontSize: 13, fontWeight: 700, color: BRAND.orange },

  signatureRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  signatureBlock: { width: '46%' },
  signatureLine: { borderTop: `1 solid ${BRAND.dark}`, marginTop: 14, paddingTop: 3 },
  signatureLabel: { fontSize: 8, color: BRAND.muted },

  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0, textAlign: 'center',
    fontSize: 8, color: '#ffffff', backgroundColor: BRAND.dark, paddingVertical: 6,
  },
})

function money(n: number): string {
  return `$${n.toFixed(2)}`
}

function formatDate(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export type RentalAgreementPdfInput = {
  rentalReference: string
  agreementDate: string
  unit: { model: string; equipmentType: string; serialNumber: string | null }
  renter: { name: string; company: string | null; phone: string | null; license: string | null }
  rentalType: 'daily' | 'weekly'
  rateAmount: number
  startDate: string
  endDate: string
  securityDeposit: number
  damageCap: number
  preExistingDamageNotes: string | null
  prePhotoUrls: string[]
  postPhotoUrls: string[]
  returnConditionNotes: string | null
  fuelTankEmptyAtReturn: boolean | null
  lateFeeAmount: number
  damageChargeAmount: number
  fuelChargeAmount: number
  rentalChargeTotal: number
  amountDue: number
  returned: boolean
  actualReturnDate: string | null
  logoUrl?: string | null
  agreementSignedName?: string | null
  agreementSignedAt?: string | null
}

function RentalAgreementDocument(input: RentalAgreementPdfInput) {
  const {
    rentalReference, agreementDate, unit, renter, rentalType, rateAmount, startDate, endDate,
    securityDeposit, damageCap, preExistingDamageNotes, prePhotoUrls, postPhotoUrls,
    returnConditionNotes, fuelTankEmptyAtReturn, lateFeeAmount, damageChargeAmount, fuelChargeAmount,
    rentalChargeTotal, amountDue, returned, actualReturnDate, logoUrl,
    agreementSignedName, agreementSignedAt,
  } = input
  const terms = rentalAgreementTerms(damageCap, securityDeposit)
  const rateLabel = rentalType === 'daily' ? `${money(rateAmount)}/day` : `${money(rateAmount)}/week`
  const hasExtraCharges = lateFeeAmount > 0 || damageChargeAmount > 0 || fuelChargeAmount > 0

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
              <Text style={styles.docTitle}>Chainsaw Rental Agreement</Text>
              <Text style={styles.fromLine}>{BUSINESS.legalName}</Text>
              <Text style={styles.fromLine}>{BUSINESS.address}, {BUSINESS.addressLine2}</Text>
              <Text style={styles.fromLine}>{BUSINESS.phone} · {BUSINESS.email}</Text>
            </View>
          </View>

          <View style={styles.metaRow}>
            <View>
              <Text style={styles.metaLabel}>Agreement #</Text>
              <Text style={styles.metaValue}>{rentalReference}</Text>
            </View>
            <View>
              <Text style={styles.metaLabel}>Date</Text>
              <Text style={styles.metaValue}>{formatDate(agreementDate)}</Text>
            </View>
          </View>

          <View style={styles.box}>
            <View style={styles.boxAccentBar} />
            <Text style={styles.boxTitle}>Equipment Details</Text>
            <View style={styles.fieldRow}>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Unit</Text>
                <Text style={styles.fieldValue}>{[unit.model, unit.equipmentType].filter(Boolean).join(' - ')}</Text>
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Serial Number</Text>
                <Text style={styles.fieldValue}>{unit.serialNumber || '-'}</Text>
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Rental Start Date</Text>
                <Text style={styles.fieldValue}>{formatDate(startDate)}</Text>
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Rental End Date</Text>
                <Text style={styles.fieldValue}>{formatDate(endDate)} (due by 5:00 PM)</Text>
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Rental Type</Text>
                <Text style={styles.fieldValue}>{rentalType === 'daily' ? 'Daily' : 'Weekly'} - {rateLabel}</Text>
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Security Deposit (refundable)</Text>
                <Text style={styles.fieldValue}>{money(securityDeposit)}</Text>
              </View>
            </View>
          </View>

          <View style={styles.box}>
            <View style={styles.boxAccentBar} />
            <Text style={styles.boxTitle}>Renter Information</Text>
            <View style={styles.fieldRow}>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Name</Text>
                <Text style={styles.fieldValue}>{renter.name}</Text>
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Company</Text>
                <Text style={styles.fieldValue}>{renter.company || '-'}</Text>
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Phone</Text>
                <Text style={styles.fieldValue}>{renter.phone || '-'}</Text>
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Driver&apos;s License</Text>
                <Text style={styles.fieldValue}>{renter.license || '-'}</Text>
              </View>
            </View>
          </View>

          <View style={styles.sectionDivider}>
            <Text style={styles.sectionLabel}>Rental Terms</Text>
            <View style={styles.sectionRule} />
          </View>

          {terms.map(term => (
            <View style={styles.termBlock} key={term.title}>
              <Text style={styles.termTitle}>{term.title}</Text>
              <Text style={styles.termLine}>{term.body}</Text>
            </View>
          ))}
          <Text style={styles.termLine}>Pre-existing damage noted: {preExistingDamageNotes || 'None noted'}</Text>

          <View style={styles.warnBox}>
            <Text style={styles.warnTitle}>⚠ OPERATOR MUST READ</Text>
            <Text style={styles.warnLine}>Straight fuel destroys the engine. Use ONLY 50:1 premix fuel. Improper fuel is grounds for full damage liability ({money(damageCap)}+).</Text>
          </View>

          <View style={styles.sectionDivider}>
            <Text style={styles.sectionLabel}>Pre-Rental Condition</Text>
            <View style={styles.sectionRule} />
          </View>
          {prePhotoUrls.length > 0 ? (
            <View style={styles.photoGrid}>
              {prePhotoUrls.map((url, i) => <PdfImage key={i} src={url} style={styles.photo} />)}
            </View>
          ) : (
            <Text style={styles.emptyNote}>No pre-rental photos on file.</Text>
          )}

          <View style={styles.sectionDivider}>
            <Text style={styles.sectionLabel}>Post-Rental Condition</Text>
            <View style={styles.sectionRule} />
          </View>
          {returned ? (
            <>
              {postPhotoUrls.length > 0 ? (
                <View style={styles.photoGrid}>
                  {postPhotoUrls.map((url, i) => <PdfImage key={i} src={url} style={styles.photo} />)}
                </View>
              ) : (
                <Text style={styles.emptyNote}>No return photos on file.</Text>
              )}
              <Text style={styles.termLine}>Returned: {actualReturnDate ? formatDate(actualReturnDate) : '-'}</Text>
              <Text style={styles.termLine}>Fuel tank empty at return: {fuelTankEmptyAtReturn === null ? '-' : fuelTankEmptyAtReturn ? 'Yes' : 'No'}</Text>
              {returnConditionNotes && <Text style={styles.termLine}>Condition notes: {returnConditionNotes}</Text>}

              {hasExtraCharges && (
                <View style={styles.chargesTable}>
                  {lateFeeAmount > 0 && (
                    <View style={styles.chargeRow}>
                      <Text style={styles.chargeLabel}>Late Return Fee</Text>
                      <Text style={styles.chargeValue}>{money(lateFeeAmount)}</Text>
                    </View>
                  )}
                  {fuelChargeAmount > 0 && (
                    <View style={styles.chargeRow}>
                      <Text style={styles.chargeLabel}>Fuel Refill Charge</Text>
                      <Text style={styles.chargeValue}>{money(fuelChargeAmount)}</Text>
                    </View>
                  )}
                  {damageChargeAmount > 0 && (
                    <View style={styles.chargeRow}>
                      <Text style={styles.chargeLabel}>Damage Charge (capped at {money(damageCap)})</Text>
                      <Text style={styles.chargeValue}>{money(damageChargeAmount)}</Text>
                    </View>
                  )}
                </View>
              )}
            </>
          ) : (
            <Text style={styles.emptyNote}>To be completed when the unit is returned.</Text>
          )}

          <View style={styles.totalsRow}>
            <View style={styles.totalsBlock}>
              <View style={styles.grandTotalRow}>
                <Text style={styles.grandTotalLabel}>Rental Charge</Text>
                <Text style={styles.chargeValue}>{money(rentalChargeTotal)}</Text>
              </View>
              <View style={styles.grandTotalRow}>
                <Text style={styles.grandTotalLabel}>{returned ? 'Balance Due' : 'Due at Pickup (incl. deposit)'}</Text>
                <Text style={styles.grandTotalValue}>{money(amountDue)}</Text>
              </View>
            </View>
          </View>

          <View style={styles.signatureRow} wrap={false}>
            <View style={styles.signatureBlock}>
              {agreementSignedName ? (
                <>
                  <Text style={styles.fieldValue}>{agreementSignedName}</Text>
                  <View style={styles.signatureLine}>
                    <Text style={styles.signatureLabel}>
                      Signed electronically in the Savage Chainsaws app{agreementSignedAt ? ` on ${formatDate(agreementSignedAt.slice(0, 10))}` : ''}
                    </Text>
                  </View>
                </>
              ) : (
                <View style={styles.signatureLine}>
                  <Text style={styles.signatureLabel}>Renter Signature / Date</Text>
                </View>
              )}
            </View>
            <View style={styles.signatureBlock}>
              <View style={styles.signatureLine}>
                <Text style={styles.signatureLabel}>Savage Chainsaws Representative / Date</Text>
              </View>
            </View>
          </View>
        </View>
        <Text style={styles.footer} fixed>Savage Chainsaws LLC · Rental Agreement {rentalReference}</Text>
      </Page>
    </Document>
  )
}

export async function renderRentalAgreementPdf(input: RentalAgreementPdfInput): Promise<Buffer> {
  return renderToBuffer(<RentalAgreementDocument {...input} />)
}

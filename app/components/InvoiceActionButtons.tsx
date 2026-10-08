import EditInvoiceButton from './EditInvoiceButton'
import SendInvoiceButton from './SendInvoiceButton'
import InvoicePaymentActions from './InvoicePaymentActions'
import MarkPaidToggle from './MarkPaidToggle'
import ArchiveToggle from './ArchiveToggle'
import DeleteInvoiceButton from './DeleteInvoiceButton'
import { toggleManualPaid, toggleArchived, deleteInvoice } from '../actions/invoiceLifecycle'
import { sendInvoiceEmail } from '../actions/sendInvoiceEmail'
import { generatePaymentLink, checkPaymentStatus } from '../actions/paymentLinks'

type ActionsCustomer = { id: string; name: string; email: string | null; phone: string | null }

type ActionsInvoice = {
  id: string
  invoiceNumber: string
  amount: number
  lineItems: { description: string; amount: number }[] | null
  taxRatePercent: number
  cardSurchargeAmount: number
  laborType: 'STLA' | 'NTSTLA' | null
  paidAt: string | null
  archivedAt: string | null
  paymentLinkUrl: string | null
  unitLabel: string | null
  unitId: string | null
  customerId: string | null
  customerName: string
  defaultEmail: string
  notes: string | null
  pdfUrl: string | null
  sentAt: string | null
}

// Same action row for both the Active/Archived Invoices desktop table and
// its mobile-card twin (see app/invoices/page.tsx) - identical buttons
// either way, just a different outer wrapper to lay them out in.
export default function InvoiceActionButtons({
  invoice: r,
  customers,
}: {
  invoice: ActionsInvoice
  customers: ActionsCustomer[]
}) {
  return (
    <>
      {r.pdfUrl ? (
        <a
          href={r.pdfUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-orange-400 hover:text-orange-300 pt-1"
        >
          PDF
        </a>
      ) : (
        <span className="text-xs text-gray-600 pt-1">No PDF</span>
      )}
      <EditInvoiceButton
        invoiceId={r.id}
        invoiceNumber={r.invoiceNumber}
        amount={r.amount}
        lineItems={r.lineItems}
        taxRatePercent={r.taxRatePercent}
        includeCardSurcharge={r.cardSurchargeAmount > 0}
        laborType={r.laborType}
        isPaid={!!r.paidAt}
        hasPaymentLink={!!r.paymentLinkUrl}
        unitLabel={r.unitLabel}
        unitId={r.unitId}
        customers={customers}
        customerId={r.customerId}
        customerName={r.customerName}
        customerEmail={r.defaultEmail}
        notes={r.notes}
      />
      {r.pdfUrl && (
        <SendInvoiceButton
          invoiceId={r.id}
          defaultEmail={r.defaultEmail}
          alreadySent={!!r.sentAt}
          action={sendInvoiceEmail}
        />
      )}
      <InvoicePaymentActions
        invoiceId={r.id}
        paymentLinkUrl={r.paymentLinkUrl}
        isPaid={!!r.paidAt}
        generateAction={generatePaymentLink}
        checkStatusAction={checkPaymentStatus}
      />
      <MarkPaidToggle invoiceId={r.id} isPaid={!!r.paidAt} action={toggleManualPaid} />
      {/* Only offered for unpaid invoices - a paid one is already
          archived by its paid_at, and un-archiving it here would
          do nothing (it'd still show as archived via paid_at),
          which is confusing. "Mark Unpaid" is the real undo for those. */}
      {!r.paidAt && (
        <ArchiveToggle invoiceId={r.id} isArchived={!!r.archivedAt} action={toggleArchived} />
      )}
      <DeleteInvoiceButton
        invoiceId={r.id}
        invoiceNumber={r.invoiceNumber}
        action={deleteInvoice}
      />
    </>
  )
}

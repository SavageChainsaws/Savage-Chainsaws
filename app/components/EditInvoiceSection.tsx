import EditInvoiceForm from './EditInvoiceForm'
import { parseInvoiceLineItemsForEdit, type BillingLine } from '@/lib/billing'

type UnitInvoice = {
  id: string
  invoice_number: string | null
  amount: number
  paid_at: string | null
  square_payment_link_url: string | null
  stripe_payment_link_url: string | null
  line_items: BillingLine[] | null
  notes: string | null
  sales_tax_rate: number | null
  card_surcharge_amount: number | null
  labor_type: string | null
}

// Lets Jesse handle a mid-service change request (customer calls asking
// for a chain added, a part removed, a price corrected) against the
// unit's most recent invoice without creating a whole new one - reopens
// that invoice's Parts/Labor lines, recalculates tax + surcharge off the
// edited subtotal on save, and regenerates the same invoice/PDF in
// place. Only rendered when a real invoices row exists for this unit -
// a unit whose only "invoice" is a manually uploaded photo/PDF (see
// updateStatus's invoice-upload field) has no row to edit here.
export default function EditInvoiceSection({
  unit,
  latestInvoiceByUnit,
  currentCustomer,
  defaultTaxRatePercent,
}: {
  unit: { id: string }
  latestInvoiceByUnit: Map<string, UnitInvoice>
  currentCustomer: { name: string; email: string | null } | null
  defaultTaxRatePercent: number
}) {
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

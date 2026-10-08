// Read-only lookup of the customer's own contact info (phone/email/
// secondary email) from their existing customer record - nothing here
// is unit-specific, it's just surfaced from the action row so admin
// doesn't have to leave this panel to find a number to call.
export default function CustomerInfoSection({
  customer,
}: {
  customer: { name: string; phone: string | null; email: string | null; secondary_email: string | null } | null
}) {
  if (!customer) return null
  const fields: { label: string; href: string; value: string }[] = []
  if (customer.phone) fields.push({ label: 'Phone', href: `tel:${customer.phone}`, value: customer.phone })
  if (customer.email) fields.push({ label: 'Email', href: `mailto:${customer.email}`, value: customer.email })
  if (customer.secondary_email) {
    fields.push({ label: 'Secondary Email', href: `mailto:${customer.secondary_email}`, value: customer.secondary_email })
  }
  if (fields.length === 0) return null
  return (
    <details className="group/customer-info ml-auto">
      <summary className="inline-flex items-center gap-1.5 cursor-pointer list-none select-none bg-zinc-700 hover:bg-zinc-600 text-white text-sm px-4 py-1.5 rounded-lg whitespace-nowrap">
        Customer Info
        <span className="text-xs group-open/customer-info:rotate-180 transition">v</span>
      </summary>
      <div className="w-full mt-2 bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-2.5 space-y-1.5">
        <p className="text-sm font-medium text-white">{customer.name}</p>
        {fields.map(f => (
          <p key={f.label} className="text-xs text-gray-400">
            <span className="text-gray-500">{f.label}: </span>
            <a href={f.href} className="text-orange-400 hover:text-orange-300 underline">{f.value}</a>
          </p>
        ))}
      </div>
    </details>
  )
}

import { hexToRgba, SAVAGE_BRAND_COLOR } from '@/lib/color'

type GroupCustomer = { brand_color?: string | null; logo_url?: string | null; name?: string | null; referral_source_id?: string | null } | null

export default function CustomerGroupHeader({ customer, count }: { customer: GroupCustomer; count: number }) {
  const accent = customer?.brand_color || SAVAGE_BRAND_COLOR
  return (
    <div
      className="flex items-center gap-3 px-4 sm:px-6 py-2.5 border-b"
      style={{ backgroundColor: hexToRgba(accent, 0.16), borderBottomColor: hexToRgba(accent, 0.4) }}
    >
      {customer?.logo_url ? (
        <img
          src={customer.logo_url}
          alt={customer.name || ''}
          className="h-9 w-9 rounded-lg object-contain bg-zinc-900 border border-zinc-700 shrink-0"
        />
      ) : null}
      <h3 className="text-lg sm:text-xl font-bold text-white truncate">{customer?.name || 'Unknown Customer'}</h3>
      {customer?.referral_source_id && (
        <span
          title="Referred customer - premier welcome + first-service discount"
          className="shrink-0 flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40"
        >
          ★ Referred
        </span>
      )}
      <span className="text-xs text-gray-400 shrink-0 ml-auto">{count} unit{count !== 1 ? 's' : ''}</span>
    </div>
  )
}

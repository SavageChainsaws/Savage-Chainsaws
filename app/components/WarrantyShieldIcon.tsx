// Read-only shield indicator, reusing the same isUnderWarranty()/
// warranty_end data as the admin side's Fleet Units icon - sized larger
// (h-5 w-5 vs admin's h-4 w-4) since customer screens benefit from more
// visibility here than a dense admin list does.
export default function WarrantyShieldIcon({ underWarranty }: { underWarranty: boolean }) {
  return (
    <span
      title={underWarranty ? 'Under warranty' : 'Not under warranty'}
      className={`shrink-0 ${underWarranty ? 'text-blue-400' : 'text-zinc-600'}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill={underWarranty ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="M12 2 4 5v6c0 5 3.4 8.7 8 11 4.6-2.3 8-6 8-11V5l-8-3Z" />
        {underWarranty && <path d="m9 12 2 2 4-4" stroke="#09090b" />}
      </svg>
    </span>
  )
}

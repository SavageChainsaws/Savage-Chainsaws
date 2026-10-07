// Shared date formatters - previously reimplemented independently in
// app/page.tsx (admin dashboard) and app/customer/page.tsx (customer
// portal), byte-for-byte identical in the case of formatShortDate.

export function formatDate(dateString: string | null) {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export function formatShortDate(dateString: string | null) {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

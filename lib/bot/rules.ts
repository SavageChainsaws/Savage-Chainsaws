// Pure, DB-free business rules shared by the /api/bot/app/* routes - kept
// separate from the route handlers (which do the actual Supabase I/O) so
// the rules that matter most for safety - the reminder throttle, what
// App Bot is forbidden to change on an invoice, and how a dedup match is
// scored - are unit-testable without a live database. A route calls these
// with data it already fetched; nothing here reaches the network.

export const REMINDER_MIN_INTERVAL_DAYS = 3

export type ReminderDecision = { allowed: true } | { allowed: false; reason: ReminderBlockReason }
export type ReminderBlockReason = 'invoice_not_sent' | 'already_paid' | 'missing_due_date' | 'throttled'

// App Bot must recheck payment status itself (via the real Stripe/Square
// check) before calling this - `paidAt` here is expected to already
// reflect that fresh check, not a stale cached value.
export function canSendReminder({
  invoiceStatus,
  paidAt,
  dueDate,
  lastReminderSentAt,
  now = new Date(),
}: {
  invoiceStatus: string
  paidAt: string | null
  dueDate: string | null
  lastReminderSentAt: string | null
  now?: Date
}): ReminderDecision {
  if (invoiceStatus !== 'sent') return { allowed: false, reason: 'invoice_not_sent' }
  if (paidAt) return { allowed: false, reason: 'already_paid' }
  // No due date on file - never assume NET 30 or any other term; this
  // invoice needs Jesse to confirm payment terms before it can be
  // reminded about (see docs/HANDOFF.md).
  if (!dueDate) return { allowed: false, reason: 'missing_due_date' }
  if (lastReminderSentAt) {
    const elapsedMs = now.getTime() - new Date(lastReminderSentAt).getTime()
    const minMs = REMINDER_MIN_INTERVAL_DAYS * 24 * 60 * 60 * 1000
    if (elapsedMs < minMs) return { allowed: false, reason: 'throttled' }
  }
  return { allowed: true }
}

// What App Bot is never allowed to change on an existing invoice via
// PATCH /api/bot/app/invoices/:id - checked against the patch body
// regardless of what the route's own column allowlist would otherwise
// accept, as a second, independent gate.
export function forbiddenInvoicePatchReason(
  invoice: { status: string },
  patch: Record<string, unknown>
): string | null {
  if (invoice.status !== 'draft' && ('line_items' in patch || 'amount' in patch)) {
    return 'cannot_change_amount_on_a_non_draft_invoice'
  }
  if ('paid_at' in patch || 'paid_via' in patch) {
    return 'cannot_manually_mark_paid'
  }
  if ('invoice_number' in patch) {
    return 'cannot_change_invoice_number'
  }
  return null
}

export type MatchCandidate = { id: string; label: string }
export type MatchResult =
  | { confidence: 'none' }
  | { confidence: 'exact'; id: string }
  | { confidence: 'ambiguous'; candidates: MatchCandidate[] }

// A verified-unique signal (email for a customer; a real, non-placeholder
// serial number scoped to one customer for a unit) resolving to exactly
// one row is the only thing treated as a confirmed match. Anything else -
// zero matches on the strong signal but one or more on a weaker one (name
// alone), or more than one match on any signal - is ambiguous and must be
// reviewed by Jesse rather than silently linked or silently duplicated.
export function resolveMatch(byStrongSignal: MatchCandidate[], byWeakSignal: MatchCandidate[]): MatchResult {
  if (byStrongSignal.length === 1) return { confidence: 'exact', id: byStrongSignal[0].id }
  if (byStrongSignal.length > 1) return { confidence: 'ambiguous', candidates: byStrongSignal }
  if (byWeakSignal.length > 0) return { confidence: 'ambiguous', candidates: byWeakSignal }
  return { confidence: 'none' }
}

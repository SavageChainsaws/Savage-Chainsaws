// Pure, DB-free business rules shared by the /api/bot/app/* routes - kept
// separate from the route handlers (which do the actual Supabase I/O) so
// the rules that matter most for safety - the reminder throttle, what
// App Bot is forbidden to change on an invoice, and how a dedup match is
// scored - are unit-testable without a live database. A route calls these
// with data it already fetched; nothing here reaches the network.

export const REMINDER_MIN_INTERVAL_DAYS = 3

export type ReminderDecision = { allowed: true } | { allowed: false; reason: ReminderBlockReason }
export type ReminderBlockReason =
  | 'invoice_not_sent'
  | 'already_paid'
  | 'missing_due_date'
  | 'archived'
  | 'zelle_claim_pending'
  | 'on_payment_plan'
  | 'throttled'

// `status` is set to 'sent' the moment an invoice's PDF is generated - at
// CREATION time, before anyone ever emails it to the customer (see
// app/api/invoice/route.ts/custom/route.ts) - so it is NOT a signal that
// the customer has actually been contacted. `sent_at` is only ever written
// by sendInvoiceEmail() once the email itself succeeds, so that is the real
// "was this actually sent to the customer" signal a reminder must gate on.
//
// App Bot must recheck payment status itself (via the real Stripe/Square
// check) before calling this - `paidAt` here is expected to already
// reflect that fresh check, not a stale cached value. The throttle check
// here (`lastReminderSentAt`) is a fast local pre-check only - the actual
// race-safe enforcement happens in the `claim_invoice_reminder` DB function
// the route calls afterward (see app/api/bot/app/invoices/[id]/send-
// reminder/route.ts), which serializes concurrent attempts for the same
// invoice with an advisory lock.
export function canSendReminder({
  sentAt,
  paidAt,
  dueDate,
  archivedAt = null,
  zelleClaimPending = false,
  hasActivePaymentPlan = false,
  lastReminderSentAt,
  now = new Date(),
}: {
  sentAt: string | null
  paidAt: string | null
  dueDate: string | null
  archivedAt?: string | null
  zelleClaimPending?: boolean
  hasActivePaymentPlan?: boolean
  lastReminderSentAt: string | null
  now?: Date
}): ReminderDecision {
  if (!sentAt) return { allowed: false, reason: 'invoice_not_sent' }
  if (paidAt) return { allowed: false, reason: 'already_paid' }
  if (archivedAt) return { allowed: false, reason: 'archived' }
  // The customer has already told us they paid via Zelle and it's pending
  // Jesse's verification - reminding them to pay again would be wrong.
  if (zelleClaimPending) return { allowed: false, reason: 'zelle_claim_pending' }
  // An active installment plan has its own payment cadence - reminding
  // about the invoice's full original total would be confusing/incorrect
  // for a customer who is current on their plan. Installment-level
  // reminders are a separate, not-yet-built feature.
  if (hasActivePaymentPlan) return { allowed: false, reason: 'on_payment_plan' }
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
// accept, as a second, independent gate. `parts_line_items`/
// `labor_line_items` are the actual keys the route's request body uses
// (not a flat `line_items`/`amount` - checking only those would never
// fire, since the route never receives them under those names).
export function forbiddenInvoicePatchReason(
  invoice: { status: string; sentAt: string | null },
  patch: Record<string, unknown>
): string | null {
  const touchesLineItems = 'parts_line_items' in patch || 'labor_line_items' in patch || 'line_items' in patch || 'amount' in patch
  // Not a draft, OR a draft that's already been emailed to the customer
  // (sent_at set) - either way the amount is no longer App Bot's to touch.
  // Checked here AND re-enforced in the route's own UPDATE filter (never
  // trust this check alone to prevent a race between the read and the
  // write).
  if (touchesLineItems && (invoice.status !== 'draft' || !!invoice.sentAt)) {
    return 'cannot_change_amount_on_a_non_draft_invoice'
  }
  if ('paid_at' in patch || 'paid_via' in patch) {
    return 'cannot_manually_mark_paid'
  }
  if ('invoice_number' in patch) {
    return 'cannot_change_invoice_number'
  }
  // due_date is Jesse's call only - it's how he confirms a customer's
  // actual payment terms, never something App Bot infers or sets.
  if ('due_date' in patch) {
    return 'cannot_set_due_date'
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

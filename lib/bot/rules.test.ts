import { describe, it, expect } from 'vitest'
import { canSendReminder, forbiddenInvoicePatchReason, resolveMatch, REMINDER_MIN_INTERVAL_DAYS } from './rules'

describe('canSendReminder', () => {
  const base = {
    sentAt: '2026-01-01T00:00:00Z',
    paidAt: null,
    dueDate: '2026-01-05',
    lastReminderSentAt: null,
  }

  it('allows a first reminder on an actually-emailed, unpaid, dated invoice', () => {
    expect(canSendReminder(base)).toEqual({ allowed: true })
  })

  it('blocks a reminder when sent_at is null - status alone (set at PDF creation, before any email) is not enough', () => {
    expect(canSendReminder({ ...base, sentAt: null })).toEqual({ allowed: false, reason: 'invoice_not_sent' })
  })

  it('blocks a reminder once the invoice is paid, even if everything else would allow it', () => {
    expect(canSendReminder({ ...base, paidAt: '2026-01-02T00:00:00Z' })).toEqual({ allowed: false, reason: 'already_paid' })
  })

  it('blocks a reminder on an archived invoice', () => {
    expect(canSendReminder({ ...base, archivedAt: '2026-01-03T00:00:00Z' })).toEqual({ allowed: false, reason: 'archived' })
  })

  it('blocks a reminder while a Zelle claim is pending verification', () => {
    expect(canSendReminder({ ...base, zelleClaimPending: true })).toEqual({ allowed: false, reason: 'zelle_claim_pending' })
  })

  it('blocks a reminder while the invoice is on an active installment plan', () => {
    expect(canSendReminder({ ...base, hasActivePaymentPlan: true })).toEqual({ allowed: false, reason: 'on_payment_plan' })
  })

  it('blocks a reminder with no due date rather than assuming NET 30 or any other term', () => {
    expect(canSendReminder({ ...base, dueDate: null })).toEqual({ allowed: false, reason: 'missing_due_date' })
  })

  it('blocks a duplicate reminder sent less than the minimum interval ago', () => {
    const now = new Date('2026-01-10T00:00:00Z')
    const lastReminderSentAt = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString()
    expect(canSendReminder({ ...base, lastReminderSentAt, now })).toEqual({ allowed: false, reason: 'throttled' })
  })

  it('allows a reminder once the minimum interval has fully elapsed', () => {
    const now = new Date('2026-01-10T00:00:00Z')
    const lastReminderSentAt = new Date(now.getTime() - REMINDER_MIN_INTERVAL_DAYS * 24 * 60 * 60 * 1000 - 1000).toISOString()
    expect(canSendReminder({ ...base, lastReminderSentAt, now })).toEqual({ allowed: true })
  })

  it('blocks a reminder exactly at the throttle boundary (not yet fully elapsed)', () => {
    const now = new Date('2026-01-10T00:00:00Z')
    const lastReminderSentAt = new Date(now.getTime() - REMINDER_MIN_INTERVAL_DAYS * 24 * 60 * 60 * 1000 + 1000).toISOString()
    expect(canSendReminder({ ...base, lastReminderSentAt, now })).toEqual({ allowed: false, reason: 'throttled' })
  })
})

describe('forbiddenInvoicePatchReason', () => {
  it('forbids changing line items/amount on a non-draft invoice', () => {
    expect(forbiddenInvoicePatchReason({ status: 'sent', sentAt: null }, { line_items: [] })).toBe('cannot_change_amount_on_a_non_draft_invoice')
    expect(forbiddenInvoicePatchReason({ status: 'sent', sentAt: null }, { amount: 50 })).toBe('cannot_change_amount_on_a_non_draft_invoice')
  })

  it('forbids changing line items via the actual route payload shape (parts_line_items/labor_line_items)', () => {
    expect(forbiddenInvoicePatchReason({ status: 'sent', sentAt: null }, { parts_line_items: [] })).toBe('cannot_change_amount_on_a_non_draft_invoice')
    expect(forbiddenInvoicePatchReason({ status: 'draft', sentAt: null }, { labor_line_items: [] })).toBeNull()
  })

  it('forbids changing line items on a draft that has already been emailed (status alone is not enough)', () => {
    expect(forbiddenInvoicePatchReason({ status: 'draft', sentAt: '2026-01-01T00:00:00Z' }, { parts_line_items: [] })).toBe('cannot_change_amount_on_a_non_draft_invoice')
  })

  it('allows changing line items on a true draft (draft status, never emailed)', () => {
    expect(forbiddenInvoicePatchReason({ status: 'draft', sentAt: null }, { parts_line_items: [] })).toBeNull()
  })

  it('forbids manually marking an invoice paid regardless of status', () => {
    expect(forbiddenInvoicePatchReason({ status: 'draft', sentAt: null }, { paid_at: new Date().toISOString() })).toBe('cannot_manually_mark_paid')
    expect(forbiddenInvoicePatchReason({ status: 'sent', sentAt: null }, { paid_via: 'cash' })).toBe('cannot_manually_mark_paid')
  })

  it('forbids changing the invoice number', () => {
    expect(forbiddenInvoicePatchReason({ status: 'draft', sentAt: null }, { invoice_number: 'SC-9999' })).toBe('cannot_change_invoice_number')
  })

  it('forbids setting due_date - that is Jesse-only, never App Bot\'s to set', () => {
    expect(forbiddenInvoicePatchReason({ status: 'draft', sentAt: null }, { due_date: '2026-02-01' })).toBe('cannot_set_due_date')
  })

  it('allows an unrelated field change (e.g. notes) on any status', () => {
    expect(forbiddenInvoicePatchReason({ status: 'sent', sentAt: null }, { notes: 'customer called' })).toBeNull()
  })
})

describe('resolveMatch', () => {
  it('treats exactly one strong-signal match as a confirmed match', () => {
    expect(resolveMatch([{ id: 'a', label: 'x' }], [])).toEqual({ confidence: 'exact', id: 'a' })
  })

  it('treats more than one strong-signal match as ambiguous, never auto-picked', () => {
    const candidates = [{ id: 'a', label: 'x' }, { id: 'b', label: 'y' }]
    expect(resolveMatch(candidates, [])).toEqual({ confidence: 'ambiguous', candidates })
  })

  it('treats a weak-signal-only match as ambiguous, never auto-linked', () => {
    const candidates = [{ id: 'a', label: 'x' }]
    expect(resolveMatch([], candidates)).toEqual({ confidence: 'ambiguous', candidates })
  })

  it('treats no matches at all as safe to create new', () => {
    expect(resolveMatch([], [])).toEqual({ confidence: 'none' })
  })

  it('prefers the strong signal over the weak one when both have exactly one match on different rows', () => {
    const strong = [{ id: 'a', label: 'x' }]
    const weak = [{ id: 'b', label: 'y' }]
    expect(resolveMatch(strong, weak)).toEqual({ confidence: 'exact', id: 'a' })
  })
})

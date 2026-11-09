import { describe, it, expect } from 'vitest'
import { canSendReminder, forbiddenInvoicePatchReason, resolveMatch, REMINDER_MIN_INTERVAL_DAYS } from './rules'

describe('canSendReminder', () => {
  const base = {
    invoiceStatus: 'sent',
    paidAt: null,
    dueDate: '2026-01-01',
    lastReminderSentAt: null,
  }

  it('allows a first reminder on a sent, unpaid, dated invoice', () => {
    expect(canSendReminder(base)).toEqual({ allowed: true })
  })

  it('blocks a reminder on a draft (never actually sent) invoice', () => {
    expect(canSendReminder({ ...base, invoiceStatus: 'draft' })).toEqual({ allowed: false, reason: 'invoice_not_sent' })
  })

  it('blocks a reminder once the invoice is paid, even if everything else would allow it', () => {
    expect(canSendReminder({ ...base, paidAt: '2026-01-02T00:00:00Z' })).toEqual({ allowed: false, reason: 'already_paid' })
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
    expect(forbiddenInvoicePatchReason({ status: 'sent' }, { line_items: [] })).toBe('cannot_change_amount_on_a_non_draft_invoice')
    expect(forbiddenInvoicePatchReason({ status: 'sent' }, { amount: 50 })).toBe('cannot_change_amount_on_a_non_draft_invoice')
  })

  it('allows changing line items/amount on a draft invoice', () => {
    expect(forbiddenInvoicePatchReason({ status: 'draft' }, { line_items: [] })).toBeNull()
  })

  it('forbids manually marking an invoice paid regardless of status', () => {
    expect(forbiddenInvoicePatchReason({ status: 'draft' }, { paid_at: new Date().toISOString() })).toBe('cannot_manually_mark_paid')
    expect(forbiddenInvoicePatchReason({ status: 'sent' }, { paid_via: 'cash' })).toBe('cannot_manually_mark_paid')
  })

  it('forbids changing the invoice number', () => {
    expect(forbiddenInvoicePatchReason({ status: 'draft' }, { invoice_number: 'SC-9999' })).toBe('cannot_change_invoice_number')
  })

  it('allows an unrelated field change (e.g. notes) on any status', () => {
    expect(forbiddenInvoicePatchReason({ status: 'sent' }, { notes: 'customer called' })).toBeNull()
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

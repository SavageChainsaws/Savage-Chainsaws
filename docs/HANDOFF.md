# Savage Chainsaws — App Handoff Doc

*Written 2026-11-08, verified directly against the live codebase (`claude/customer-login-redirect-fix-n1q020`) and the live Supabase schema. Where something doesn't exist, it says so rather than guessing. Check `CHANGELOG.md` for everything that's happened since this was written — update both together when either goes stale.*

## 1. Overview

**What it does today:** Savage Chainsaws LLC's internal shop-management app — chainsaw/small-engine repair, equipment rentals, and invoicing for a one-person mobile repair business in Oviedo, FL. Three user-facing surfaces: an admin dashboard (Jesse), a customer portal, and a referral-partner portal.

**Tech stack:** Next.js 16.3.8 (App Router, Turbopack), React 19.2.8, TypeScript 5, Tailwind CSS 4. Supabase (Postgres + Auth + Storage). Stripe (current card processor) and Square (legacy, kept only so old outstanding links still resolve). Resend (transactional email). `web-push` (VAPID push notifications). `@react-pdf/renderer` (invoice/rental-agreement PDFs, server-side). No test framework configured (no jest/vitest/playwright).

**Repo:** `https://github.com/SavageChainsaws/Savage-Chainsaws`. **Production branch:** `main`. **Working branch:** `claude/customer-login-redirect-fix-n1q020` — the long-lived feature branch (~100+ merges); push there, PR into `main` when asked.

**Production URL:** `app.savagechainsaws.com`. **Preview URLs:** Vercel auto-builds a preview for every non-`main` push (e.g. `savage-chainsaws-git-claude-customer-lo-*.vercel.app`); these never reach production on their own.

**Vercel:** project `savage-chainsaws` (id `prj_d7q6BwoRnKGY1vu0HpWq7lXolWiz`). Only a merge to `main` deploys to `app.savagechainsaws.com` — a push to the working branch is **not** live until merged.

## 2. Access

**Auth method:** Supabase Auth (email/password + magic link). Three separate identity surfaces, not one role column:
- **Admin/staff** — a row in `profiles` (PK = `auth.users.id`), `role = 'admin'`. Checked everywhere via `is_admin()` (a `SECURITY DEFINER` SQL function) or `getSessionInfo()` in `lib/supabase/server.ts`.
- **Customer** — `customers.auth_user_id` points at `auth.users.id` directly (no `profiles` row). `customer_users` exists for a "multiple logins per customer account" model (`role` defaults `'viewer'`) but **has 0 rows — not wired into any real flow yet**.
- **Referral partner** — `referral_sources.auth_user_id`, same direct pattern.

**What a bot (App Bot, New Bot, Financial Bot) should use — recommendation: app API routes / server actions, not Supabase API directly, and not UI login.**
- **UI admin login**: works but brittle for a bot (session expiry, no audit trail distinguishing bot from Jesse, no granular permissions).
- **Supabase REST/JS client with the anon key**: subject to RLS, which is good, but most admin writes (invoice creation, next invoice number, PDF upload) are *only* exposed through app code today (business logic — tax rules, numbering, PDF rendering — lives in `lib/billing.ts` and `app/api/invoice/*`, not in the database). Calling Supabase directly would mean reimplementing that logic outside the app.
- **Supabase REST/JS client with the service-role key**: bypasses RLS entirely. Only ever used the way `lib/supabase/admin.ts` already does — narrow, specific, server-side, never from a bot with broad standing access.
- **Best option: dedicated API routes a bot calls**, same pattern as the existing `app/api/invoice/*` routes, gated by a bot-specific auth mechanism (a `profiles` row with a distinct role, or a signed service token checked in the route) — not the human admin's session, and not raw table access. **This doesn't exist yet** — Claude builds it when asked (code/migrations stay Claude-only, see §7).

**Environment variable names** (values live in Vercel, never here):

| Public | Server-only secret |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `SUPABASE_SERVICE_ROLE_KEY` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `STRIPE_SECRET_KEY` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | `STRIPE_WEBHOOK_SECRET` |
| | `SQUARE_ACCESS_TOKEN` |
| | `SQUARE_LOCATION_ID` |
| | `SQUARE_WEBHOOK_SIGNATURE_KEY` |
| | `RESEND_API_KEY` |
| | `RESEND_FROM_EMAIL` |
| | `VAPID_PRIVATE_KEY` |

Optional, defaulted in code if unset: `SQUARE_ENVIRONMENT` (defaults to production Square), `VAPID_SUBJECT` (defaults to `mailto:service@savagechainsaws.com`).

## 3. Data model

Supabase project `swoddrotqrdjirminnni` ("Savage CHainsaws"). 34 tables. Grouped by what they're for:

**Core shop entities**
| Table | PK | Key columns | Purpose |
|---|---|---|---|
| `customers` | `id` (uuid) | `name`, `email`, `auth_user_id`, `referral_source_id` | **Source of truth for customers.** |
| `units` | `id` (uuid) | `serial_number` (NOT NULL), `model`, `customer_id`→customers, `status`, `hour_meter` (text), `invoice_url` | **Source of truth for customer-owned equipment going through repair.** Not the rental fleet — see `rental_units` below, a separate concept. |
| `service_history` | `id` (uuid) | `unit_id`→units, `service_date`, `description`, `cost` | **Source of truth for work-order/service records.** Free-text `description`, no structured parts/hours fields (see gaps below). |
| `unit_photos` | `id` | `unit_id`→units, `url`, `media_type`, `stage` | Photos/video per unit. |
| `messages` | `id` | `customer_id`, `unit_id` | Admin↔customer chat per unit. |
| `approvals` | `id` | `unit_id`→units | Repair-estimate approvals. Built, 0 rows. |

**Invoicing/payments**
| Table | PK | Key columns | Purpose |
|---|---|---|---|
| `invoices` | `id` (uuid) | `invoice_number`, `unit_id`→units (nullable), `customer_id`→customers (nullable), `amount`, `line_items` (jsonb), `status`, `pdf_url`, `paid_at`, `paid_via`, Stripe/Square link columns | **Source of truth for invoices.** `unit_id` null ⇒ standalone invoice (no tracked unit). |
| `invoice_payment_plans` | `id` | `invoice_id`→invoices (**UNIQUE**, 1:1) | Installment plan header. |
| `invoice_installments` | `id` | `plan_id`→plans, `invoice_id`→invoices, UNIQUE(`plan_id`,`sequence`) | Individual installments. |

**Rentals** (separate from customer-owned equipment above)
| Table | PK | Purpose |
|---|---|---|
| `rental_units` | `id` | The shop's own rental fleet (saws Jesse rents out). |
| `rentals` | `id` | One rental transaction against a `rental_units` row. |
| `rental_agreements` | `id` | A second, newer multi-unit rental flow. **Built, 0 rows, not actually used** — real rentals go through `rentals` instead. |

**Parts/catalog reference** (read-only reference datasets, not business data)
`parts_catalog` (19,983 rows, STIHL catalog, UNIQUE `sku`), `rotary_parts` (11,094 rows, PK `sku`), `oem_cross_references` (3,577 rows), `model_parts` / `unit_part_overrides` (SKU resolution per model/unit, used for invoice line-item autofill).

**Specs/reference docs**
`equipment_spec_sheets`, `reference_guides`, `reference_guide_pages` — scanned STIHL reference material, browsable in-app under the Specs tab. Not customer/business data.

**Other**: `customer_users` (0 rows, unused), `unit_customer_notes` (0 rows, unused), `referral_sources`, `push_subscriptions`, `shop_settings` (key/value, e.g. tax rate), `feedback`, `inventory` (0 rows), `resources` (0 rows), `profiles`.

**Four tables that are a naming-collision trap — `service_customers`, `service_equipment`, `service_parts_list`, `business_documents`.** These are an **earlier, abandoned prototype** of exactly what "work orders/service records" means now (`service_equipment.pin_serial`, `engine_make/model`, `customer_id` as **integer**, a completely different ID space from `customers.id`). Not connected to `units`/`customers`/`service_history`, 1–5 rows each (test data), and **RLS is disabled on all four** — fully readable/writable by anyone with the anon key. Flagged to Jesse twice, deprioritized by him. **Do not build on these** — they predate and duplicate the real model.

**Unique constraints / natural keys — gaps found, with proposals (not yet applied — ask Claude to migrate):**
- **`units`**: no unique constraint beyond PK. **Propose**: `UNIQUE (customer_id, serial_number)`.
- **`customers`**: no unique constraint on `name` or `email`. **Propose**: `UNIQUE (lower(email))` where `email IS NOT NULL`, plus app-level name checking (name alone isn't a safe key).
- **`invoices.invoice_number`**: safely generated via `next_invoice_number()` in the normal path, but **no DB-level `UNIQUE` constraint** — a direct insert bypassing the RPC could collide. **Propose**: `UNIQUE (invoice_number)`.
- Already done right, model new tables on these: `customer_users` `UNIQUE(customer_id, email)`, `order_sheet_items` `UNIQUE(unit_id, sku)`, `model_parts` `UNIQUE(model_key, part_name_key)`.

**RLS, in one sentence per role:** every table has an `admins full access` policy keyed on `is_admin()`. Customer-scoped tables additionally let a customer read/write only rows reachable from `customers.auth_user_id = auth.uid()` (directly, or via `units.customer_id`/`invoices.customer_id`). Referral sources can read their own row and the customers they referred. No table grants broad anon write access except `feedback` (anyone can submit) and the `invoices`/`rentals` storage buckets (public upload policy, used before an admin session exists in those server routes).

## 4. How to add or update data without duplicates

**Customers**: match on `lower(email)` first (once the proposed unique index exists); fall back to exact `name` match only with explicit confirmation, never silently. No dedicated "create customer" API route exists today — it's done inline wherever a unit/invoice is created (`app/page.tsx`'s `addUnit`/`addFleetUnit` actions).

**Units/equipment**: match on `(customer_id, serial_number)` — once the proposed constraint exists, `upsert({ onConflict: 'customer_id,serial_number' })` is correct. Until then, query-then-insert-or-update explicitly; never blind-insert.

**Service records (New Bot's field data)**: insert into `service_history`, matched to the unit via `(customer_id, serial_number)` lookup against `units` first — never create a service record for a unit that doesn't exist; create the unit first, explicitly. Sample row New Bot should hand App Bot:
```json
{
  "customer_name": "DeAngelo's Land Service",
  "customer_email": "anthony@landtree.us",
  "unit_serial_number": "298123456",
  "unit_model": "MS 271",
  "unit_equipment_type": "Chainsaw",
  "hour_meter": "142.3",
  "service_date": "2026-11-08",
  "service_description": "Tune-up: air filter, spark plug, chain sharpened",
  "parts_used": ["1110 400 7005 - Spark plug NGK", "0000 400 7000 - Spark plug"],
  "cost": 85.00
}
```
**Gap**: `service_history` has no structured "hours" or "parts used" column — only free-text `description` and `cost`. `units.hour_meter` is a single text field that gets *overwritten*, not a log over time. **Doesn't exist yet.** Proposed real fix: add `hour_meter` and `parts_used jsonb` columns to `service_history` itself, so each service record carries its own reading/parts rather than only ever keeping the latest hour reading on `units`.

**How a customer ends up seeing their units/fleet**: purely RLS — `units.customer_id` matches the `customers` row whose `auth_user_id` equals the logged-in customer's `auth.uid()`. Nothing needs to be "published"; as soon as a unit row exists with the right `customer_id` it appears on `/customer`.

## 5. Invoicing

**Created/numbered**: three routes — `app/api/invoice/route.ts` (per-unit), `app/api/invoice/custom/route.ts` (standalone), `app/api/invoice/edit/route.ts` (re-save). All call `next_invoice_number()` (admin-gated `SECURITY DEFINER` RPC, format `SC-0001`...) — **the only correct way to mint a number**.

**Stored**: `invoices` table + a PDF uploaded to the `invoices` Storage bucket, filename `${invoiceId}.pdf`, URL saved to `invoices.pdf_url`.

**Stripe vs Square — Stripe is the current source of truth.** Square is legacy, kept only so already-sent Square payment links still resolve. New invoices use Stripe Checkout Sessions. Both webhook-driven (`app/api/webhooks/stripe/route.ts`, `app/api/webhooks/square/route.ts`, signature-verified), with manual admin "Check Payment Status"/"Mark Paid" as fallback.

**Statuses**: `invoices.status` is free text (`'draft'`, `'sent'` used in practice). Paid/unpaid is derived from `paid_at IS NOT NULL` (or a pending Zelle claim), not from `status`. **"Overdue" does not exist** — no `due_date` column, nothing computed. Needs a real migration before App Bot can do overdue follow-ups: add `invoices.due_date`, pick a default (e.g. 15/30 days from `sent_at`), backfill, then overdue = `due_date < now() AND paid_at IS NULL`.

**Reminder/follow-up emails: don't exist yet.** `sendInvoiceEmail` (`app/actions/sendInvoiceEmail.ts`) is one-shot and admin-triggered only — no cron, no scheduled anything anywhere in this codebase.

## 6. API routes, server actions, functions

**API routes** (`app/api/**/route.ts`):
| Route | Does | Auth |
|---|---|---|
| `invoice/route.ts` | Create per-unit invoice + PDF | admin |
| `invoice/custom/route.ts` | Create standalone invoice + PDF | admin |
| `invoice/edit/route.ts` | Re-save invoice, regenerate PDF | admin |
| `parts-catalog/lookup/route.ts` | SKU→description/price autofill | admin |
| `payment-plan/create/route.ts` | Customer self-selects installment plan | customer (own invoice only) |
| `push/notify-admin/route.ts` | Push notification to Jesse's device | internal |
| `rental/route.ts`, `rental/sign/route.ts`, `rental/return/route.ts` | Create/sign/return a rental | admin (sign also accepts customer context) |
| `rental-agreement/sign/route.ts` | Sign the multi-unit agreement variant | mixed |
| `webhooks/square/route.ts`, `webhooks/stripe/route.ts` | Mark invoice/rental paid | signature-verified, no user auth |
| `instant-signup/route.ts` | Public signup via a texted secret-token link | **unauthenticated by design**, gated by a token in `shop_settings` |

**Server actions** (`app/actions/*.ts`): `auth.ts`, `customerLogins.ts`, `fleetCheckIn.ts`, `invoiceLifecycle.ts` (mark paid/archive/delete), `orderSheet.ts`, `paymentLinks.ts`, `paymentPlans.ts`, `sendInvoiceEmail.ts`, `serviceHistory.ts`, `shopSettings.ts`, `unitParts.ts`, `unitPhotos.ts`, `unitWorkflow.ts`, `zelleClaims.ts` — all admin-gated via `isAdmin` unless the action's own comment says otherwise (e.g. `zelleClaims.ts`'s customer-initiated claim, ownership-checked in code first).

**Edge Functions**: none. **Cron jobs**: none exist anywhere in this project.

## 7. Work rules so we don't clash

- **Schema changes always through migrations, applied properly, never ad hoc in the Supabase dashboard.**
- **Claude owns**: all code in the repo, all schema migrations, billing math (`lib/billing.ts`), PDF rendering (`lib/invoicePdf.tsx`), payment integrations (`lib/stripe.ts`/`lib/square.ts`). Stem, App Bot, New Bot, Financial Bot do not write code or run migrations — ask Claude, then use the resulting API route.
- **App Bot can do on its own**: data entry that matches an existing record 1:1, invoice drafts, sending reminders *once that feature exists*. **Must ask first**: creating a new customer or unit that doesn't match an existing one, changing a dollar amount on an already-sent invoice, deleting anything.
- **Financial Bot**: read-only, by design — no write path should ever be built for it without Jesse explicitly asking.
- **Changelog**: `CHANGELOG.md` at repo root, owned by Stem. One line per change: date, who, what. Claude checks it (and this file) before building anything new, and adds a line for every change Claude makes too.
- **Checklist before creating anything new** (table, function, component): (1) grep the repo for the exact word and close synonyms, (2) check this doc's §3 table list, (3) check `service_customers`/`service_equipment`/`service_parts_list` aren't being reinvented, (4) check `CHANGELOG.md` for anything recent that already covers it, (5) if genuinely new, say so in the changelog before/as you build it, don't just add it silently.

## 8. Current state

**Finished**: unit repair tracking, invoicing (Stripe-primary/Square-legacy), rentals (per-unit flow), customer/referrer portals, push notifications, the Specs & Guides reference tab (12 reference documents, admin-only).

**Half-built/unused**: `rental_agreements` (0 rows — real rentals use `rentals` instead), `invoice_payment_plans`/`invoice_installments`/`approvals` (built, unexercised), `inventory`/`resources`/`customer_users`/`unit_customer_notes` (0 rows), `service_customers`/`service_equipment`/`service_parts_list` (abandoned prototype — don't build on these).

**Known issues right now**:
1. Invoice SC-0051 (Reliable Lawn Services, $1,090.12) has no PDF — hit a since-fixed negative-line-item bug at creation time; Jesse texted a screenshot instead. Fix is ready, pending his go-ahead to run it.
2. RLS disabled on the 4 `service_*`/`business_documents` tables — flagged to Jesse twice, deprioritized by him.
3. A new table needs both an RLS policy *and* an explicit `GRANT` to `authenticated`/`anon` — missing the grant alone makes it silently return empty with no error. Hit this twice this session; watch for it on any new table.

**Test/demo data**: none — all row counts in §3 are real production data.

## 9. Risks

- **Duplicate invoices**: only `next_invoice_number()` prevents number collisions, and only in the normal path. Always call the RPC or go through `/api/invoice/*`.
- **Double charges**: a payment link is only generated once per invoice and reused unless expired. Always check `stripe_payment_link_url`/`square_payment_link_url` before generating a new one.
- **Duplicate customers/units**: real gap today (§3), no unique constraints yet. Any automated data entry must query-match before inserting.
- **Data loss**: `deleteInvoice` deletes the stored PDF and the DB row together, irreversibly. No undo.
- **The `service_*` prototype tables**: RLS disabled means anything touching them writes to a publicly-writable table. Leave them alone.

## Quick start for a new bot's first session

1. Read this doc in full, then `CHANGELOG.md`, before doing anything.
2. Confirm your actual auth path — a bot-specific API route (preferred, may need building — ask Claude) or a real admin session. Never use the service-role key directly for routine work.
3. Before creating any customer or unit, query for an existing match first — there's no DB constraint stopping a duplicate yet.
4. For invoices: always go through `/api/invoice/route.ts` or `/api/invoice/custom/route.ts`. Never hand-build `line_items` and insert directly.
5. Never invent an invoice number — call `next_invoice_number()`.
6. Reminders/overdue follow-ups don't exist yet — don't improvise a due-date convention; ask for the migration first.
7. New Bot's field data lands in `service_history` against an existing `units` row matched by `(customer_id, serial_number)`; create the unit first if it's missing, explicitly.
8. Any schema change you think you need: don't make it. Ask Claude for a migration.
9. Add a line to `CHANGELOG.md` for what you did.
10. Unsure whether something's a duplicate, a new record, or touches money? Ask, don't guess.

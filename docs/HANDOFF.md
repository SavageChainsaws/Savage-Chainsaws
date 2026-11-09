# Savage Chainsaws — App Handoff Doc

*Written 2026-11-08, verified directly against the live codebase (`claude/customer-login-redirect-fix-n1q020`) and the live Supabase schema. Where something doesn't exist, it says so rather than guessing. Check `CHANGELOG.md` for everything that's happened since this was written — update both together when either goes stale.*

## 1. Overview

**What it does today:** Savage Chainsaws LLC's internal shop-management app — chainsaw/small-engine repair, equipment rentals, and invoicing for a one-person mobile repair business in Oviedo, FL. Three user-facing surfaces: an admin dashboard (Jesse), a customer portal, and a referral-partner portal.

**Tech stack:** Next.js 16.3.8 (App Router, Turbopack), React 19.2.8, TypeScript 5, Tailwind CSS 4. Supabase (Postgres + Auth + Storage). Stripe (current card processor) and Square (legacy, kept only so old outstanding links still resolve). Resend (transactional email). `web-push` (VAPID push notifications). `@react-pdf/renderer` (invoice/rental-agreement PDFs, server-side). Vitest (added 2026-11-09, `npm test`) — unit tests for `lib/bot/*`'s pure rules/auth/idempotency logic; no browser/e2e test runner.

**Repo:** `https://github.com/SavageChainsaws/Savage-Chainsaws`. **Production branch:** `main`. **Working branch:** `claude/customer-login-redirect-fix-n1q020` — the long-lived feature branch (~100+ merges); push there, PR into `main` when asked.

**Production URL:** `app.savagechainsaws.com`. **Preview URLs:** Vercel auto-builds a preview for every non-`main` push (e.g. `savage-chainsaws-git-claude-customer-lo-*.vercel.app`); these never reach production on their own.

**Vercel:** project `savage-chainsaws` (id `prj_d7q6BwoRnKGY1vu0HpWq7lXolWiz`). Only a merge to `main` deploys to `app.savagechainsaws.com` — a push to the working branch is **not** live until merged.

## 2. Access

**Auth method:** Supabase Auth (email/password + magic link). Three separate identity surfaces, not one role column:
- **Admin/staff** — a row in `profiles` (PK = `auth.users.id`), `role = 'admin'`. Checked everywhere via `is_admin()` (a `SECURITY DEFINER` SQL function) or `getSessionInfo()` in `lib/supabase/server.ts`.
- **Customer** — `customers.auth_user_id` points at `auth.users.id` directly (no `profiles` row). `customer_users` exists for a "multiple logins per customer account" model (`role` defaults `'viewer'`) but **has 0 rows — not wired into any real flow yet**.
- **Referral partner** — `referral_sources.auth_user_id`, same direct pattern.

**App Bot, Financial Bot, and Unit Bot (added 2026-11-09, PR pending Stem's review) authenticate with a dedicated bearer token against `/api/bot/*` routes.** Each bot gets its own individually-revocable token (`lib/bot/auth.ts`): generated and shown exactly once in the admin UI (`/bot-tokens`, admin-only), only its SHA-256 hash is ever stored (`bot_tokens.token_hash`), never the plaintext — not in the repo, not in a log, not in chat. Every `/api/bot/*` route (`lib/bot/respond.ts`'s `withBotAuth`) checks the token names the *specific* bot the route is scoped to (none of the three bots' tokens can ever authenticate a route scoped to a different one) before doing anything else, using the service-role client internally (RLS can't gate a bot with no `auth.uid()`, so permission is enforced in route code, not RLS — RLS on the bot tables is defense in depth only). `withBotAuth` also rate-limits every call, per bot scope, to `RATE_LIMIT_MAX_PER_WINDOW` (120) per `RATE_LIMIT_WINDOW_SECONDS` (60) — see `lib/bot/rateLimit.ts` — a fixed-lookback count against `bot_audit_log`, applied uniformly to all three bots. See §6 for the route list and §7 for what each bot may/may not do.

**`service_role` needs real table-level `GRANT`s, not just `BYPASSRLS`** — a production outage on 2026-11-09 (App Bot/Financial Bot both getting `401` with zero `bot_audit_log` entries) traced to exactly this: `service_role` bypasses RLS but had never been `GRANT`ed anything at the Postgres level on these or several pre-existing tables. Fixed in `20261109060000_grant_service_role_access.sql` with a blanket `GRANT ALL ... TO service_role` plus `ALTER DEFAULT PRIVILEGES`, so this is already handled for Unit Bot and every table it touches — no new `GRANT`s needed in its own migration.

**Token delivery (do this once, after the migration below is applied and this is deployed):** open `/bot-tokens` as Jesse, generate a token for each bot, copy the plaintext shown (it will never be shown again), and hand it to that bot's own config/secrets store in Grok Bot out-of-band — never paste it into this chat, a commit, or any file in this repo.

Still true for anything NOT behind one of these routes: raw Supabase access (anon or service-role key) is the wrong path for a bot — see the reasoning below, unchanged.
- **UI admin login**: works but brittle for a bot (session expiry, no audit trail distinguishing bot from Jesse, no granular permissions).
- **Supabase REST/JS client with the anon key**: subject to RLS, which is good, but most admin writes (invoice creation, next invoice number, PDF upload) are *only* exposed through app code today (business logic — tax rules, numbering, PDF rendering — lives in `lib/billing.ts` and `app/api/invoice/*`, not in the database). Calling Supabase directly would mean reimplementing that logic outside the app.
- **Supabase REST/JS client with the service-role key**: bypasses RLS entirely. Only ever used the way `lib/supabase/admin.ts` already does — narrow, specific, server-side, never from a bot with broad standing access.

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
| `customers` | `id` (uuid) | `name`, `email`, `auth_user_id`, `referral_source_id`, `address`/`business_name`/`notes`/`created_by_bot_name` (added 2026-11-09, App Bot customer-creation PR - see below/§7) | **Source of truth for customers.** |
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

**Bot access** (added 2026-11-09, migration `20261109000000_bot_access.sql` — see §7 for what each bot may do)
| Table | PK | Key columns | Purpose |
|---|---|---|---|
| `bot_tokens` | `id` | `bot_name` (`app_bot`\|`financial_bot`\|`unit_bot`), `token_hash` (UNIQUE, SHA-256 — plaintext never stored), `revoked_at`, `last_used_at` | One row per issued bot token. |
| `bot_audit_log` | `id` | `bot_name`, `action`, `endpoint`, `outcome` (`success`\|`denied`\|`error`), `detail` jsonb | Every bot action attempt, allowed or denied. `detail` never contains a secret. |
| `bot_idempotency_keys` | `id` | UNIQUE(`bot_name`,`endpoint`,`idempotency_key`) | Replays a retried mutating request's stored response instead of re-running it. |
| `invoice_reminders` | `id` | `invoice_id`→invoices, `sent_at`, `bot_name` | Log of reminder emails actually sent — the throttle (1 per invoice per 3 days) is computed off this. |

**Other**: `customer_users` (0 rows, unused), `unit_customer_notes` (0 rows, unused), `referral_sources`, `push_subscriptions`, `shop_settings` (key/value, e.g. tax rate), `feedback`, `inventory` (0 rows), `resources` (0 rows), `profiles`.

**Four tables that are a naming-collision trap — `service_customers`, `service_equipment`, `service_parts_list`, `business_documents`.** These are an **earlier, abandoned prototype** of exactly what "work orders/service records" means now (`service_equipment.pin_serial`, `engine_make/model`, `customer_id` as **integer**, a completely different ID space from `customers.id`). Not connected to `units`/`customers`/`service_history`, 1–5 rows each (test data), and **RLS is disabled on all four** — fully readable/writable by anyone with the anon key. Flagged to Jesse twice, deprioritized by him. **Do not build on these** — they predate and duplicate the real model. Hit again directly 2026-11-09: Unit Bot's spec asked for an alt-vendor parts cross-reference (`rotary_sku`/`rotary_oem_ref`/`alt_vendor`/`alt_part_number`/`alt_notes`) on `service_parts_list` specifically - it keys off `equipment_id` (that abandoned prototype's own integer PK), with no path from a real `units.id` at all, so those five columns were added to `unit_part_overrides` instead (already `unit_id`-linked, RLS-enabled, already carries `sku`/`sku_type`) - **flagged explicitly in that PR rather than silently substituted.**

**Unit Bot** (added 2026-11-09, PR pending Stem's review) also added `service_history.created_by_bot_name` (nullable, `null` = a human admin entered it, `'app_bot'`/`'unit_bot'` = which bot did) - this is how `PATCH /api/bot/unit/service-history/:id` enforces "Unit Bot may only edit an entry it created itself," never an admin's or App Bot's.

**App Bot customer creation** (added 2026-11-09, PR pending Stem's review) added `customers.address`/`business_name`/`notes` (none of the three existed before - confirmed against the live schema) and `customers.created_by_bot_name` (nullable, `null` = a human admin entered it, only `'app_bot'` is a valid non-null value - same pattern as `service_history.created_by_bot_name` above) - this is how `PATCH /api/bot/app/customers/:id` enforces "App Bot may only edit the contact fields on a customer it created itself," never one Jesse entered by hand.

**Unique constraints / natural keys:**
- **`customers`**: `UNIQUE(invoice_number)` on `invoices`, and `UNIQUE(lower(email)) WHERE email IS NOT NULL` on `customers` — both **confirmed live via `pg_indexes` on 2026-11-09** (re-verified after a review asked specifically whether this was actually applied or just asserted; it is — as `customers_lower_email_key`/`customers_email_unique_idx`, two identical indexes that both predate this PR, a pre-existing duplication left alone as out of scope here).
- **`units`**: `units_customer_identifying_serial_key` — a *partial* unique index on `(customer_id, lower(trim(serial_number)))` (trimmed before lowercasing, so `"ABC123"` and `" ABC123 "` collide as the same serial), excluding placeholder values (`unknown`, `n/a`, `na`, `none`, `unk`, `tbd`, `-`, `--`, `?`, and the **empty string** — `serial_number` is NOT NULL, so "no real serial yet" is always `''`, never `null`, and it needs excluding exactly like every other placeholder or a second serial-less unit for the same customer 500s). Same list as `lib/units.ts`'s `isIdentifyingSerial()`. A real serial can't be entered twice for the same customer; a placeholder (or blank) can, since several different physical units legitimately share one. Applied in `20261109000000_bot_access.sql`.
- Already done right, model new tables on these: `customer_users` `UNIQUE(customer_id, email)`, `order_sheet_items` `UNIQUE(unit_id, sku)`, `model_parts` `UNIQUE(model_key, part_name_key)`.

**RLS, in one sentence per role:** every table has an `admins full access` policy keyed on `is_admin()`. Customer-scoped tables additionally let a customer read/write only rows reachable from `customers.auth_user_id = auth.uid()` (directly, or via `units.customer_id`/`invoices.customer_id`). Referral sources can read their own row and the customers they referred. No table grants broad anon write access except `feedback` (anyone can submit) and the `invoices`/`rentals` storage buckets (public upload policy, used before an admin session exists in those server routes).

## 4. How to add or update data without duplicates

**Via the bot routes, the matching is done for you and is intentionally conservative.** Units (`POST /api/bot/app/units`, `POST /api/bot/unit/units`) use `lib/bot/rules.ts`'s `resolveMatch()`: exactly one match on the strong signal (a real, non-placeholder serial scoped to that customer) is treated as confirmed and reused; zero matches on the strong signal but any on a weaker one (name alone), or more than one match on any signal, comes back `409 Ambiguous` for Jesse to resolve by hand — never auto-linked, never auto-duplicated. **Customers** (`POST /api/bot/app/customers`, added 2026-11-09, see §6/§7) use a narrower, literal check instead, never name-based: an existing customer with the same email (case-insensitive, same rule `customers_lower_email_key` enforces) or the same phone comes back as a plain `409` with that customer's `id`/`name` — there is no "ambiguous" tier for customers, only "duplicate" or "create". Doing either outside the bot routes, the same rules apply manually:

**Customers**: match on `lower(email)` first (`UNIQUE(lower(email)) WHERE email IS NOT NULL` exists), then `phone`; fall back to exact `name` match only with explicit confirmation, never silently. No dedicated "create customer" API route exists outside the bot one above — the admin UI does it inline wherever a unit/invoice is created (`app/page.tsx`'s `addUnit`/`addFleetUnit` actions).

**Units/equipment**: match on `(customer_id, lower(serial_number))`, excluding placeholder serials (see §3's `units_customer_identifying_serial_key`) — a placeholder serial never counts as a match signal, since several different physical units legitimately share one.

**Service records (New Bot's field data)**: insert into `service_history` via `POST /api/bot/app/service-records`, matched to the unit via `unit_id` — the route 404s if the unit doesn't exist; create the unit first, explicitly, via `POST /api/bot/app/units`. Sample body New Bot should hand App Bot:
```json
{
  "unit_id": "<uuid from POST /api/bot/app/units>",
  "service_date": "2026-11-08",
  "description": "Tune-up: air filter, spark plug, chain sharpened",
  "hour_meter": "142.3",
  "parts_used": ["1110 400 7005 - Spark plug NGK", "0000 400 7000 - Spark plug"],
  "cost": 85.00
}
```
`service_history.hour_meter` and `.parts_used` (jsonb) are per-visit — added in `20261109000000_bot_access.sql` precisely because `units.hour_meter` is a single field that only ever holds the *latest* reading, not a log over time. `hour_meter` is always the equipment's running-hours meter for that visit, **never labor/time-worked** — there is no labor-hours column anywhere in this schema, and none should be inferred from this one.

**How a customer ends up seeing their units/fleet**: purely RLS — `units.customer_id` matches the `customers` row whose `auth_user_id` equals the logged-in customer's `auth.uid()`. Nothing needs to be "published"; as soon as a unit row exists with the right `customer_id` it appears on `/customer`.

## 5. Invoicing

**Created/numbered**: three routes — `app/api/invoice/route.ts` (per-unit), `app/api/invoice/custom/route.ts` (standalone), `app/api/invoice/edit/route.ts` (re-save). All call `next_invoice_number()` (admin-gated `SECURITY DEFINER` RPC, format `SC-0001`...) — **the only correct way to mint a number**.

**Stored**: `invoices` table + a PDF uploaded to the `invoices` Storage bucket, filename `${invoiceId}.pdf`, URL saved to `invoices.pdf_url`.

**Stripe vs Square — Stripe is the current source of truth.** Square is legacy, kept only so already-sent Square payment links still resolve. New invoices use Stripe Checkout Sessions. Both webhook-driven (`app/api/webhooks/stripe/route.ts`, `app/api/webhooks/square/route.ts`, signature-verified), with manual admin "Check Payment Status"/"Mark Paid" as fallback.

**Statuses**: `invoices.status` is free text (`'draft'`, `'sent'` used in practice). **`status = 'sent'` is set at PDF-creation time** (`app/api/invoice/route.ts`/`custom/route.ts`), **before anyone has actually emailed it to the customer** — it is not a "was this sent to the customer" signal. `sent_at` is the real one: only ever written by `sendInvoiceEmail()` once the email itself succeeds. Anything gating on "has this invoice actually been sent to the customer" (App Bot's reminder rule, the draft-editability window) must check `sent_at`, not `status`. Paid/unpaid is derived from `paid_at IS NOT NULL` (or a pending Zelle claim), not from `status` either.

**`due_date`** (added 2026-11-09, `invoices.due_date date`, nullable): **never defaulted, never backfilled, never assumed NET 30 or any other term anywhere in this codebase, and never written by App Bot** — the PATCH route rejects `due_date` in the request body outright (`forbiddenInvoicePatchReason`). Existing invoices are left `NULL` on purpose. Jesse sets/confirms it per-invoice at `/invoices` (the "No Due Date"/"Due M/D" control next to each row — `app/actions/invoiceDueDate.ts`). An invoice with no `due_date` is flagged (`missing_due_date` in `GET /api/bot/financial/summary`'s aging buckets) and App Bot's reminder rule (`canSendReminder` in `lib/bot/rules.ts`) refuses to send a reminder for it rather than guessing. "Overdue" = `due_date < now() AND paid_at IS NULL`, computed on read, never stored.

**Reminder/follow-up emails** (added 2026-11-09, revised twice after Stem's review caught real races/gaps): `POST /api/bot/app/invoices/:id/send-reminder` — App Bot only, and only for an invoice with `sent_at` actually set (never `status`, see above). Fails closed throughout: a Stripe/Square check error aborts with nothing sent (never "send anyway"); "paid" is only trusted once a CONFIRMED paid amount matches the invoice's own total (Square can report `state: 'COMPLETED'` with zero tenders, leaving the paid amount unknown rather than merely unequal - an unknown amount fails closed exactly like a mismatched one, never "no problem found"); an expired Stripe Checkout Session link (always expires within 24h) is refreshed or the send is refused, never emailed dead; an invoice that's archived, has an unresolved Zelle claim, or is on an active installment plan is skipped; every interpolated value in the email HTML is escaped. The 1-per-3-days throttle itself is enforced atomically in Postgres (`claim_invoice_reminder`, with a transaction-scoped advisory lock keyed on the invoice id) rather than check-then-insert in app code, so two concurrent calls for the same invoice can never both get through. `sendInvoiceEmail` (`app/actions/sendInvoiceEmail.ts`) remains the separate, one-shot, admin-triggered *first* send — it now also flips `status` to `'sent'` (not just `sent_at`), so a bot-created draft that gets emailed doesn't stay `status='draft'` forever and silently fall out of every query that filters drafts out. Still no cron anywhere in this codebase; reminders are called on demand by App Bot, not on a schedule the app itself runs.

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
| `bot/app/customers` (GET/POST) | List/read customers; create a customer (`name` required, `phone`/`email`/`address`/`business_name`/`notes` optional) after a literal duplicate-email-or-phone check (see §4) - returns `409` with the existing `id`/`name` on a match, never a second record; never creates a `customer_users` login, email, or notification | App Bot token |
| `bot/app/customers/[id]` (PATCH) | Update `phone`/`email`/`address`/`business_name`/`notes` only, and **only on a customer App Bot itself created** (`customers.created_by_bot_name = 'app_bot'`, hard `403` otherwise) - logs before/after | App Bot token |
| `bot/app/units` (GET/POST) | List/read units; create-or-match (see §4) | App Bot token |
| `bot/app/service-records` (GET/POST) | List/read service records; add one to an existing unit | App Bot token |
| `bot/app/invoices` (GET/POST) | List/read invoices; create a **draft** invoice (reuses `lib/billing.ts`/`lib/invoicePdf.tsx`/`next_invoice_number()`) | App Bot token |
| `bot/app/invoices/[id]` (PATCH) | Edit a **draft invoice that hasn't been emailed yet** (`status='draft' AND sent_at IS NULL`, enforced in the UPDATE's own filter, not just checked beforehand) — line items/notes only, never `due_date`. `forbiddenInvoicePatchReason()` blocks amount changes once sent, manual paid-marking, invoice-number changes, and `due_date`, unconditionally | App Bot token |
| `bot/app/invoices/[id]/check-payment` (POST) | Recheck Stripe/Square; writes `paid_at`/`paid_via` only on provider confirmation AND a matching amount, never the bot's assertion | App Bot token |
| `bot/app/invoices/[id]/send-reminder` (POST) | Send a reminder for an invoice with `sent_at` set, unpaid, dated, not archived, no pending Zelle claim, no active payment plan — throttled atomically, idempotent (see §5) | App Bot token |
| `bot/financial/invoices` (GET) | Read-only invoice list — customer id+name, amounts, dates, status; no email/phone/notes | Financial Bot token |
| `bot/financial/installments` (GET) | Read-only real installment records (`invoice_installments`/`invoice_payment_plans`) — sequence, amount, due date, paid status per installment, not just an "offered a plan" flag | Financial Bot token |
| `bot/financial/summary` (GET) | Read-only aging buckets (current/1-30/31-60/61-90/90+/missing due date, archived write-offs excluded) + revenue total for a window; `truncated: true` if the 1000-row cap was hit | Financial Bot token |
| `bot/unit/units` (GET/POST) | List/read units (filter by customer/serial/model/archived); create-or-match (same `resolveMatch()` dedup as App Bot's) against an existing customer only | Unit Bot token |
| `bot/unit/units/[id]` (PATCH) | Update `model`/`serial_number`/`equipment_type`/`hour_meter`/`part_numbers`/`nickname`/`fleet_notes`/`notes`/`purchase_date`/`last_service_date`/`customer_id` only (`forbiddenUnitPatchReason()` rejects anything else, including `archived` and `part_number` singular - see §7) - reassigning `customer_id` requires the new customer to already exist (`customerExists()`); logs before/after for every field actually changed | Unit Bot token |
| `bot/unit/service-history` (GET/POST) | List per unit; add an entry (stamps `created_by_bot_name`), bumping `units.hour_meter`/`last_service_date` when the new entry is more recent | Unit Bot token |
| `bot/unit/service-history/[id]` (PATCH) | Edit an entry **only if `created_by_bot_name = 'unit_bot'`** - never an admin's or App Bot's entry; logs before/after | Unit Bot token |
| `bot/unit/parts/model-parts` (GET/POST) | Read/upsert `model_parts` (sku + `sku_type`: OEM/Aftermarket), matched by the table's own `(model_key, part_name_key)` unique index; logs before/after | Unit Bot token |
| `bot/unit/parts/unit-overrides` (GET/POST) | Read/upsert `unit_part_overrides` for one unit (sku/sku_type plus the alt-vendor cross-reference fields - see §3); logs before/after | Unit Bot token |
| `bot/unit/parts/catalog` (GET) | Read-only `?sku=` exact lookup (`parts_catalog`/`rotary_parts`/`oem_cross_references`) or `?q=` search - never writes a price | Unit Bot token |
| `bot/unit/equipment-spec-sheets` (GET) | Read-only factory spec sheets, filterable by model/category | Unit Bot token |
| `bot/unit/photos` (GET/POST) | List/add a `unit_photos` row (the file itself already uploaded elsewhere; this records the url) | Unit Bot token |
| `bot/unit/notes` (GET/POST) | Read/upsert `unit_customer_notes` for one unit; logs before/after | Unit Bot token |

**Server actions** (`app/actions/*.ts`): `auth.ts`, `customerLogins.ts`, `fleetCheckIn.ts`, `invoiceLifecycle.ts` (mark paid/archive/delete), `orderSheet.ts`, `paymentLinks.ts`, `paymentPlans.ts`, `sendInvoiceEmail.ts`, `serviceHistory.ts`, `shopSettings.ts`, `unitParts.ts`, `unitPhotos.ts`, `unitWorkflow.ts`, `zelleClaims.ts` — all admin-gated via `isAdmin` unless the action's own comment says otherwise (e.g. `zelleClaims.ts`'s customer-initiated claim, ownership-checked in code first).

**Edge Functions**: none. **Cron jobs**: none exist anywhere in this project.

## 7. Work rules so we don't clash

- **Schema changes always through migrations, applied properly, never ad hoc in the Supabase dashboard.**
- **Claude owns**: all code in the repo, all schema migrations, billing math (`lib/billing.ts`), PDF rendering (`lib/invoicePdf.tsx`), payment integrations (`lib/stripe.ts`/`lib/square.ts`). Stem, App Bot, New Bot, Financial Bot, Unit Bot do not write code or run migrations — ask Claude, then use the resulting API route.
- **Is Unit Bot the same thing as "New Bot"?** Flagging this rather than guessing: New Bot was originally scoped (this doc, written 2026-11-08) as "logs field data (hours, serial numbers, units serviced, parts used)" and writes into `service_history` - which is exactly Unit Bot's scope (units, service history, parts, photos, notes). Unit Bot was requested as a third bot *scope* alongside App Bot and Financial Bot, which reads as New Bot getting its own dedicated token under this access model rather than a genuinely separate fourth bot - but that's an inference, not something confirmed. Jesse/Stem should confirm whether "New Bot" is now retired in favor of Unit Bot, or whether both still exist as distinct things.
- **App Bot, via `/api/bot/app/*` (built 2026-11-09, see §6), may**: read customers/units/service records/invoices/payment status; create and edit **draft** invoices (reusing existing billing/numbering/PDF logic); check payment status (writes `paid_at` only on Stripe/Square confirmation, never its own assertion); add service records to a confirmed existing unit; create a unit *only* when `resolveMatch()` confirms no ambiguity (§4) — an ambiguous match is a `409`, Jesse's to resolve, never auto-created/auto-linked; create a customer directly (literal email-or-phone duplicate check, §4 — a match is a `409` with the existing `id`/`name`, never auto-linked); PATCH the contact fields (`phone`/`email`/`address`/`business_name`/`notes`) on a customer **it itself created**, never one Jesse entered by hand; send a reminder for a previously-sent, unpaid, dated invoice, throttled to once per 3 days with a send log and idempotency protection, rechecking payment status fresh first.
- **App Bot must not, and the routes enforce this in code, not just by convention**: delete any record (no delete endpoint exists, anywhere in `/api/bot/app/*`), manually mark an invoice paid (`forbiddenInvoicePatchReason` blocks `paid_at`/`paid_via` in any PATCH), change the amount/line items on an already-sent invoice (same function blocks it unless `status = 'draft'`), send a brand-new invoice for the first time — **there is no bot endpoint that flips a draft to `sent`**; that first send is Jesse's call through the normal admin UI — create a customer portal login (`customer_users`), send a welcome email/SMS, or trigger any other notification when creating a customer (that stays Jesse's own, separate step), change `name` or anything admin-managed (a portal login, referral/payment-plan flags) on a customer via PATCH (`forbiddenCustomerPatchReason()`'s allowlist is contact fields only), or PATCH a customer it didn't itself create (`created_by_bot_name != 'app_bot'` is a hard `403`).
- **Financial Bot, via `/api/bot/financial/*`, is read-only** — invoices, payments, installments, due dates, outstanding balances, aging, revenue summaries. Customer id+name only, for matching; **never** email, phone, or service notes. No write path should ever be built for it without Jesse explicitly asking.
- **Unit Bot, via `/api/bot/unit/*` (added 2026-11-09, PR pending Stem's review, see §6), may**: read/create/update units and their service history, read/upsert parts data (`model_parts`/`unit_part_overrides`), read parts-catalog/spec-sheet reference data, add photos, and update per-unit customer notes - all scoped to a unit's identity and service record, never money.
- **Unit Bot must not, and the routes enforce this in code**: delete anything anywhere (no `DELETE` handler exists in any Unit Bot route file - guarded by a regression test, `app/api/bot/unit/noDelete.test.ts`, that fails if one is ever added); touch `invoices`, payments, `bot_tokens`, or any `auth.*` table; read a customer's contact info beyond `id`/`name` (its own routes never select `email`/`phone`/etc off `customers`); send a customer-facing email or push notification; change a price in `parts_catalog`/`rotary_parts` (both are read-only through this scope - no write endpoint exists for either); create a customer (only App Bot does that, via its own `resolveMatch()`-gated endpoint) - it may only reassign a unit to a customer `customerExists()` confirms already exists; write `units.part_number` (singular - a real column, but a dead one nothing else in the app reads or writes; only `part_numbers`, plural, is in `UNIT_BOT_PATCH_FIELDS`); or edit a `service_history` entry it didn't itself create (`created_by_bot_name != 'unit_bot'` is a hard `403`).
- **Every bot call's rate-limit count only reflects real, successfully-authenticated activity for that exact bot scope** - a failed/unknown/wrong-scope token is logged under `ANONYMOUS_BOT_LABEL` (`'anonymous'`, see `lib/bot/audit.ts`), never under the bot_name it was aimed at. A flood of invalid tokens aimed at App Bot's routes must never be able to lock out the real App Bot token by filling its own rate-limit window - caught in review on the Unit Bot PR, fixed in `lib/bot/respond.ts`/`lib/bot/audit.ts`, and now covered by `lib/bot/respond.test.ts`.
- **A bot's own `429` denials never count toward its own rate limit either** - `checkRateLimit()` excludes `action = 'rate_limit'` rows from the count (see `lib/bot/rateLimit.ts`), so a client that politely retries after a `429` doesn't re-trigger one forever by having each retry's own denial row extend the window it's waiting out. Left over from the first rate-limit fix above (that one only covered unauthenticated noise, not a bot's own denial rows); caught in review on the App Bot customer-creation PR, covered by `lib/bot/rateLimit.test.ts` and `lib/bot/respond.test.ts`.
- **Every bot call, all three scopes, is now rate-limited** (`lib/bot/rateLimit.ts`, applied in `withBotAuth`) - 120 calls per rolling 60s per bot scope, a `429` past that, itself audited like any other denial.
- **Every bot action is audited** (`bot_audit_log` — allowed, denied, and errored attempts alike), **detail never contains a token or secret**, and every mutating endpoint requires an `Idempotency-Key` header so a retried request replays the first attempt's result instead of creating a second record or sending a second reminder.
- **Tokens**: generate/revoke at `/bot-tokens` (admin-only). A token is shown once, at generation, and never again — see §2 for delivery.
- **Changelog**: `CHANGELOG.md` at repo root, owned by Stem. One line per change: date, who, what. Claude checks it (and this file) before building anything new, and adds a line for every change Claude makes too.
- **Checklist before creating anything new** (table, function, component): (1) grep the repo for the exact word and close synonyms, (2) check this doc's §3 table list, (3) check `service_customers`/`service_equipment`/`service_parts_list` aren't being reinvented, (4) check `CHANGELOG.md` for anything recent that already covers it, (5) if genuinely new, say so in the changelog before/as you build it, don't just add it silently.

## 8. Current state

**Finished**: unit repair tracking, invoicing (Stripe-primary/Square-legacy), rentals (per-unit flow), customer/referrer portals, push notifications, the Specs & Guides reference tab (12 reference documents, admin-only), **App Bot and Financial Bot access** (merged + migration applied + deployed 2026-11-09, including the `service_role` grant hotfix - see §2 - tokens generated and delivered).

**Built, pending Stem's review (2026-11-09) - not yet applied/deployed**: Unit Bot access — see §2, §6, §7. The migration (`supabase/migrations/20261109070000_unit_bot_access.sql`) has **not** been applied to the live database and the routes have **not** been deployed; needs Stem's review, then Jesse's explicit go-ahead, same rollout discipline as the first round. Unlike that first round, this migration needs **no new `service_role` GRANTs** - the 2026-11-09 hotfix already covers every table it touches.

**Rollout order for Unit Bot**: (1) Stem's review, land any resulting fixes, (2) re-run a live-data duplicate check for anything the migration's constraints could collide with, (3) apply the migration in one transaction, (4) confirm `/` (units) and the admin dashboard still load against the now-migrated schema, (5) merge the PR, (6) generate and deliver the Unit Bot token at `/bot-tokens` privately (never in chat, never committed) only after that deploy is live.

**Half-built/unused**: `rental_agreements` (0 rows — real rentals use `rentals` instead), `invoice_payment_plans`/`invoice_installments`/`approvals` (built, unexercised), `inventory`/`resources`/`customer_users`/`unit_customer_notes` (0 rows), `service_customers`/`service_equipment`/`service_parts_list` (abandoned prototype — don't build on these).

**Known issues right now**:
1. Invoice SC-0051 (Reliable Lawn Services, $1,090.12) has no PDF — hit a since-fixed negative-line-item bug at creation time; Jesse texted a screenshot instead. Fix is ready, pending his go-ahead to run it.
2. RLS disabled on the 4 `service_*`/`business_documents` tables — flagged to Jesse twice, deprioritized by him.
3. A new table needs both an RLS policy *and* an explicit `GRANT` to `authenticated`/`anon` — missing the grant alone makes it silently return empty with no error. Hit this twice this session; watch for it on any new table.
4. **`service_role` had no table-level `GRANT`s at all until 2026-11-09** — `BYPASSRLS` on `service_role` (confirmed via `pg_roles`) only skips RLS; it does nothing for the separate Postgres `GRANT` layer, which had simply never been set for this role. Every `createAdminClient()` call (bot routes, Stripe/Square webhooks, customer-login creation, Zelle claims) was exposed to this - for `bot_tokens`/`bot_audit_log`/`bot_idempotency_keys` it surfaced immediately and loudly as a `403` from PostgREST (not a silent empty result, unlike item 3 above - a missing `GRANT` for a *bypasses-RLS* role is a hard permission-denied, not just "RLS hid the rows"). Fixed via `20261109060000_grant_service_role_access.sql`: `GRANT ALL ... TO service_role` on every existing table/sequence/routine, plus `ALTER DEFAULT PRIVILEGES` so a future new table gets it automatically. Any new migration from here on should assume this is fixed - but if a *brand-new* Supabase project ever replaces this one, re-apply the same grants before anything using `createAdminClient()` is expected to work.

**Test/demo data**: none — all row counts in §3 are real production data.

## 9. Risks

- **Duplicate invoices**: only `next_invoice_number()` prevents number collisions, and only in the normal path. Always call the RPC or go through `/api/invoice/*`.
- **Double charges**: a payment link is only generated once per invoice and reused unless expired. Always check `stripe_payment_link_url`/`square_payment_link_url` before generating a new one.
- **Duplicate customers/units**: real gap today (§3), no unique constraints yet. Any automated data entry must query-match before inserting.
- **Data loss**: `deleteInvoice` deletes the stored PDF and the DB row together, irreversibly. No undo.
- **The `service_*` prototype tables**: RLS disabled means anything touching them writes to a publicly-writable table. Leave them alone.

## Quick start for a new bot's first session

1. Read this doc in full, then `CHANGELOG.md`, before doing anything.
2. **App Bot / Financial Bot / Unit Bot**: use your own bearer token against `/api/bot/app/*`, `/api/bot/financial/*`, or `/api/bot/unit/*` (§2, §6) — never the service-role key, never the admin UI session. Get your token from Jesse (generated at `/bot-tokens`, delivered out-of-band — it's never in this repo or in chat).
3. Every mutating bot call needs an `Idempotency-Key` header — reuse the same key only when retrying the exact same attempt, never across two different real actions. All three scopes are also rate-limited (120 calls/60s) - a `429` means slow down, not retry immediately.
4. Customer/unit creation goes through `POST /api/bot/app/customers`/`units` (App Bot) or `POST /api/bot/unit/units` (Unit Bot, existing customer only - never creates one), both already doing the duplicate check (§4) — don't query-and-insert yourself. A unit's ambiguous match, or a customer's literal email/phone duplicate, comes back as `409` either way; stop and let Jesse resolve it (or use the `id` the `409` body already gives you), don't retry with slightly different data to force a create. Only App Bot creates customers, and only App Bot may later PATCH one's contact fields (`phone`/`email`/`address`/`business_name`/`notes`) - and only one it created itself.
5. For invoices (App Bot): `POST /api/bot/app/invoices` creates a **draft only**. There is no way to make it `sent` through the bot API — that first send is Jesse's call. Never invent an invoice number yourself.
6. Reminders (App Bot): `POST /api/bot/app/invoices/:id/send-reminder` only works on an invoice already sent once, with a `due_date` on file, unpaid, and not reminded in the last 3 days. If it 409s, read why (`missing_due_date` means ask Jesse to confirm payment terms — don't guess NET 30 or anything else).
7. Field data (hours, serials, units serviced, parts used) lands in `service_history`/`units`/`unit_part_overrides` via `/api/bot/unit/*` (Unit Bot) against an existing `units` row (`unit_id`); create the unit first via `POST /api/bot/unit/units` if it's missing, explicitly. `hour_meter` is the equipment's meter reading, never labor hours. App Bot's own `/api/bot/app/service-records` still exists too (§6) for the same table.
8. Any schema change you think you need: don't make it. Ask Claude for a migration.
9. Add a line to `CHANGELOG.md` for what you did.
10. Unsure whether something's a duplicate, a new record, or touches money? Ask, don't guess.

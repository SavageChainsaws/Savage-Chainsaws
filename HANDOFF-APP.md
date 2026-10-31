# Savage Chainsaws App — Handoff

Written 2026-10-30, for migrating this project to a new Claude Code chat (desktop). Read this instead of re-deriving context from scratch. Memory notes about Jesse/the business specifically are in `handoff/memory/`.

## 1. What this is, who uses it

Savage Chainsaws is a one-person mobile chainsaw/outdoor-power-equipment repair and rental business, run by **Jesse** (sole operator — "the craftsman behind Savage Chainsaws," 10+ years turning wrenches). This repo is his **internal shop management app** — not a public marketing site (there isn't one in this repo; see §9).

Three audiences use it:
- **Jesse (admin)** — the dashboard at `/` (unit tracking / "Action Center"), `/invoices`, `/inventory`, `/parts`, `/rentals`, `/reports`. Admin status comes from a row in `profiles` (2 rows currently — Jesse plus likely one test account); checked via `getSessionInfo()` in `lib/supabase/server.ts`.
- **Customers** — a portal at `/customer` (and `/customer/login`): check in/out their own equipment, approve repair estimates, pay invoices, see rental agreements, submit Zelle payment claims.
- **Referral partners** — a portal at `/referrer` (and `/referrer/login`): see customers they referred (via a `SECURITY DEFINER` RPC that only exposes 5 safe columns) and their discount/commission status.

Brand identity: Bigfoot-with-a-chainsaw mascot logo, orange/black color scheme, tagline "We don't just fix equipment. We revive it." / "Honest work. Careful repairs. No shortcuts."

## 2. Tech stack

- **Next.js 16.3.8** (App Router, Turbopack), **React 19.2.8**, **TypeScript 5**, **Tailwind CSS 4**
- **Supabase**: Postgres + Auth + Storage (service-role client for admin-only/public-token operations, anon+RLS client for everything else)
- **Stripe** (`stripe` SDK) and **Square** — both supported payment-link providers per invoice/rental
- **Resend** — transactional email
- **web-push** — PWA push notifications (VAPID), service worker at `public/sw.js`
- **@react-pdf/renderer** — generates rental agreement PDFs and invoice PDFs server-side
- Hosted on **Vercel**

No test framework is set up (no `jest`/`vitest`/`playwright` in `package.json`). Verification so far has been `npx tsc --noEmit`, `npx eslint`, and `npx next build`.

## 3. Where the code lives

- **GitHub**: `https://github.com/SavageChainsaws/Savage-Chainsaws`
- **Production branch**: `main` — Vercel auto-deploys this to production.
- **Working branch**: `claude/customer-login-redirect-fix-n1q020` — despite the name (leftover from whatever it was first created for), this is the **long-lived feature branch** this whole project has been developed on. The established workflow (confirmed by ~100 merge commits in `git log`) is:
  1. Push commits directly to `claude/customer-login-redirect-fix-n1q020`.
  2. Open a PR from it into `main` and merge.
  3. Keep pushing new commits to the *same* branch name for the next round (don't create a new branch per feature).
  - There are ~25 other old `claude/...` branches on the remote from past one-off sessions — they're stale, not part of the active workflow.
- **Local folder (this cloud sandbox)**: `/home/user/Savage-Chainsaws`. On a desktop Claude Code session, clone `https://github.com/SavageChainsaws/Savage-Chainsaws`, then `git checkout claude/customer-login-redirect-fix-n1q020` (or `main` if everything's been merged by the time you read this — check first).
  - `AGENTS.md` / `CLAUDE.md` at the repo root are **not real project conventions** — that block is auto-written by `next dev` itself (Next.js 16's agent-rules boilerplate, regenerated on every dev server start). It's harmless noise; commit it if `next dev` re-adds it rather than fighting it.

## 4. Vercel

- **Project**: `savage-chainsaws` (team `savage-chainsaws`), project ID `prj_d7q6BwoRnKGY1vu0HpWq7lXolWiz`
- **Domains**: `app.savagechainsaws.com` (primary), `savage-chainsaws.vercel.app`, `savage-chainsaws-savage-chainsaws.vercel.app`, `savage-chainsaws-git-main-savage-chainsaws.vercel.app`
- **Production** deploys from `main` only. Pushing to any other branch (including the working branch above) only builds a **preview** deployment — it never reaches `app.savagechainsaws.com` until merged to `main`. This bit us once already (see §10) — don't assume a pushed fix is live for Jesse until it's actually merged and deployed to production.
- Node version: 24.x. Framework preset: Next.js (auto-detected).

## 5. Supabase

- **Project**: `swoddrotqrdjirminnni` (shown as "Savage CHainsaws" in the dashboard — note the stray capital H, that's just the project's display name as entered, not a typo to fix in code)
- This one Supabase project hosts **both** the main app's tables **and** a Rotary Cutter dealer parts-catalog/cross-reference dataset (`rotary_parts`, `oem_cross_references`) that got imported in to support a parts cross-reference feature — see `app/api/parts-catalog/lookup`.

Main tables (row counts as of 2026-10-30, will drift):

| Table | Rows | Purpose |
|---|---|---|
| `units` | 28 | Tracked equipment going through repair (the core dashboard entity) |
| `customers` | 13 | Customer records (portal login optional via `auth_user_id`) |
| `customer_users` | 0 | (appears unused currently — check before relying on it) |
| `invoices` | 37 | Per-unit and standalone invoices; Stripe/Square payment link + paid status live here |
| `invoice_payment_plans` / `invoice_installments` | 0 / 0 | Payment-plan feature (built, not yet used in practice) |
| `unit_photos` | 11 | Photos attached to a unit (diagnosis, condition, etc.) |
| `service_history` | 18 | Per-unit service/repair log entries |
| `messages` | 2 | Admin↔customer message thread per unit |
| `approvals` | 0 | Repair-estimate approval records (built, not yet used) |
| `unit_customer_notes` | 0 | (appears unused) |
| `order_sheet_items` | 21 | Parts pasted in during diagnosis, for the printable Order Sheet |
| `model_parts` / `unit_part_overrides` | 2 / 0 | Parts-catalog linkage per equipment model/unit |
| `parts_catalog` | 19,983 | STIHL parts catalog (SKU, description, price) — backs invoice SKU autofill |
| `rotary_parts` | 11,094 | Rotary Cutter dealer parts catalog (imported; ~8,732 rows have cost/retail priced in, rest don't — see §9) |
| `oem_cross_references` | 3,577 | OEM part number → Rotary SKU cross-reference (e.g. Honda GX200 → Rotary equivalents). **No Kohler SH-series entries at all** — see §9/§11. |
| `rental_units` | 3 | Jesse's actual rental fleet (tracked saws: at least MS194T, MS251, MS460 as of this writing) |
| `rentals` | 3 | Individual per-unit rental records against `rental_units` |
| `rental_agreements` | 0 | A **separate, newer** multi-unit rental agreement flow — built, but genuinely unused so far; see §9 |
| `feedback` | 1 | Customer feedback form submissions |
| `referral_sources` | 1 | Referral partner accounts |
| `push_subscriptions` | 1 | Web push subscriptions for admin notifications |
| `shop_settings` | 2 | Tax rate, instant-signup token, etc. |
| `inventory` / `resources` | 0 / 0 | Built features, no data yet |
| `profiles` | 2 | Admin account(s) |
| `business_documents`, `service_customers`, `service_equipment`, `service_parts_list` | 1/1/1/5 | **See the security note immediately below — these 4 do not have RLS enabled.** |

**⚠️ Security issue to flag to Jesse, not silently fix:** 4 tables — `service_customers`, `service_equipment`, `service_parts_list`, `business_documents` — have **Row Level Security disabled**. They're fully readable/writable by anyone holding the anon key (i.e. exposed in the shipped frontend bundle), not just the admin. This surfaced via a Supabase advisory check on 2026-10-30, unrelated to the session's actual task — it wasn't something we introduced, just something nobody had looked at. Enabling RLS without first writing the right policies will **block all access** including legitimate app reads, so the next session should look at how these 4 tables are actually used (they look like leftovers from an earlier "service" prototype, possibly pre-dating the `units`/`customers` model) before touching this. Remediation SQL (do not run blind):
```sql
ALTER TABLE "public"."service_customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."service_equipment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."service_parts_list" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."business_documents" ENABLE ROW LEVEL SECURITY;
```

## 6. Environment variables (names only — get actual values from Vercel's dashboard or `vercel env pull`)

Public (safe in browser bundle):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`

Server-only secrets:
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `SQUARE_ACCESS_TOKEN`
- `SQUARE_LOCATION_ID`
- `SQUARE_WEBHOOK_SIGNATURE_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `VAPID_PRIVATE_KEY`

Optional, code-level defaults exist if unset (confirmed not configured in Vercel right now, and that's fine):
- `SQUARE_ENVIRONMENT` — defaults to production Square if unset; set to `sandbox` to test against Square's sandbox.
- `VAPID_SUBJECT` — defaults to `mailto:service@savagechainsaws.com` if unset.

All 12 required vars above are currently set in Vercel under **Production** (the two `NEXT_PUBLIC_SUPABASE_*` ones are also set under **Preview**, the rest are production-only — meaning preview/branch deployments won't have Stripe/Square/Resend/push working unless that's deliberately added). There's no `.env.example` checked into the repo; this list is the closest thing to one.

## 7. Running locally and deploying

**Local dev:**
```bash
npm install
# create .env.local with all the vars from §6 (get values from Vercel)
npm run dev        # next dev, http://localhost:3000
```
Other scripts: `npm run build` (`next build`), `npm run start` (`next start`, serves the build), `npm run lint` (`eslint`).

**Deploying:**
- Automatic: push/merge to `main` on GitHub → Vercel builds and promotes to production automatically. This is the only path that reaches `app.savagechainsaws.com`.
- Any other branch (including the working branch) → Vercel still builds it, but only as a **preview** deployment at its own throwaway URL. It is not live for Jesse until merged to `main`.
- No Vercel CLI usage seen in this project's history; everything's gone through GitHub.

## 8. Every feature that's built

**Admin dashboard (`/`, "Action Center")**
- Unit tracking through a repair lifecycle: Repair Requested → Received → Diagnosing → Needs Approval → In Repair → Ready for Pickup → Returned/Picked up, plus Priority flagging.
- Per-unit: photos, diagnosis findings with a media lightbox, private notes, service history, message thread with the customer, warranty tracking, printable Order Sheet (`/order-sheet/[unitId]`) for taking STIHL parts to the store.
- Create/edit invoices per-unit or standalone (itemized parts + labor, Florida sales tax rules, card-surcharge option, SKU autofill against `parts_catalog`).
- Generate Stripe or Square payment links per invoice; manual "mark paid" override; webhook-driven auto-paid detection for both providers, with a manual "check status" fallback if a webhook is missed; expired Stripe links get regenerated on demand rather than reused dead.
- Payment plans: admin can offer/start an installment schedule on an invoice; customer can also self-select a schedule on an invoice flagged `payment_plan_offered`.
- Customer-submitted Zelle payment claims, pending admin verification.
- Referral program: referral sources/codes, discount flag surfaced to referred customers.
- Instant customer signup: admin generates a secret-token link (`shop_settings.instant_signup_token`) texted to a customer Jesse just met, skipping admin review (`/join?key=...`); contrast with the normal `/signup` flow which is admin-reviewed.
- Tap-to-talk dictation (Web Speech API) on every notes/description textarea — built for using the app one-handed/by voice in the field.
- Push notifications to the admin's phone (PWA, VAPID) when a customer does something (check-in, approve/deny, etc.).
- Shop settings: tax rate, instant signup token management.

**Rentals (`/rentals`)**
- Tracked rental fleet (`rental_units`) with daily/weekly rates, security deposit, damage cap per unit.
- Create a rental against a tracked unit → signed agreement PDF (in-app signature if the customer has portal access; blank-signature-line printable PDF for a walk-in) → unit flips to Rented.
- Return flow: condition photos, fuel-empty checkbox (+ refill charge if not), damage charge (capped at the rental's liability cap), notes. Computes a $10/day automatic late fee (due 5 PM on end date per the signed agreement). **This flow had a billing bug — see §10.**
- A **separate** multi-unit "Chainsaw Equipment Rental Agreement" flow (`rental_agreements` table, `lib/multiUnitRentalAgreement.ts`, `NewRentalAgreementButton`) for renting several saws to one customer at once off a different rate card (damage cap = a % of STIHL retail, not a flat $), with in-person e-signature. **Built but not actually used yet** — see §9.

**Customer portal (`/customer`)**
- Check in/out own equipment, see repair status and photos, approve/deny repair estimates, message the admin, pay invoices (Stripe/Square link, or submit a Zelle claim), view/sign rental agreements, see rentals from the shop's fleet.

**Referrer portal (`/referrer`)**
- See customers referred (name/discount-flag only, via a `SECURITY DEFINER` RPC — never raw financial/contact detail), referral code.

**Other**
- `/inventory` — admin inventory page (table exists, 0 rows — unused so far).
- `/resources` — admin resources page (table exists, 0 rows — unused so far).
- `/invoices` — flat admin-only list of every invoice ever generated, for bookkeeping.
- `/parts` — parts catalog UI (backs the 19,983-row STIHL `parts_catalog` and the Rotary cross-reference data).
- `/feedback` — customer feedback form.
- `/reports` — admin reporting.
- `/login`, `/signup`, `/reset-password`, `/logout`, `/customer/login`, `/referrer/login` — auth flows for the three audiences.
- A social-bio Linktree page at `/links` (rewrites to `public/linktree.html`) for Instagram/TikTok bios.

## 9. What's half done / built-but-unused

- **`rental_agreements` / multi-unit agreement flow**: fully built (commit `cc993b5`), zero rows in production. Jesse's one real multi-saw rental (3 units to "DeAngelo's Land Service") went through the *older* per-unit `rentals`/`rental_units` flow instead, done 3 separate times. Worth asking Jesse directly whether he actually wants to use the multi-unit flow going forward, or whether it should be retired/merged with the per-unit one.
- **`rotary_parts`**: 11,094 rows total, only 8,732 have `cost`/`retail_price` populated — the rest (~2,362 rows) are pre-existing hand-curated cross-reference rows (OEM part number → Rotary SKU, mostly Honda GX-series) that predate the dealer pricing import and were deliberately never overwritten by it (see the `ON CONFLICT` clause in the import — only `cost`/`retail_price`/`updated_at` get updated on existing rows, never `description`/`category`/`search_text`). Some of these have no pricing at all.
- **`oem_cross_references`**: has no Kohler SH-series entries (confirmed by query). Kohler's SH265/SH270 (GX200-class horizontal-shaft engines, used on things like Country Line log splitters) currently get manually cross-referenced to Honda GX160/GX200 parts by eyeballing the catalog — there's no actual `oem_brand = 'Kohler'` row for them. Worth adding if this comes up again.
- **`invoice_payment_plans` / `invoice_installments` / `approvals`**: built, zero rows — payment plans and the approvals workflow exist in code but haven't been exercised with real data yet, so they're unverified against real usage.
- **`inventory` / `resources` / `customer_users` / `unit_customer_notes`**: tables exist, 0 rows, corresponding pages exist but are essentially empty shells — low priority, but don't assume they're fully wired up without checking.

## 10. Known bugs

1. **FIXED, not yet deployed to production**: Rental return billing (`app/api/rental/return/route.ts`) assumed the security deposit was already collected at pickup and netted late/fuel/damage charges against it. If the pickup charge was never actually paid (`paid_at` null — Jesse often collects nothing at pickup, charges on return instead), the fix wrongly zeroed `total_owed` to $0 and even wrote a fabricated "deposit refund owed to renter" note, silently dropping the unpaid rental charge. Fixed in commit `7ff3033` — now only treats the deposit as available to net against if the pickup charge was actually paid; otherwise the unpaid rental charge gets billed at return alongside any late/fuel/damage charges. **Two already-closed rentals (MS194T, MS251 for DeAngelo's Land Service) were hand-corrected directly in the database** to `total_owed = 90` each (fix was not live yet when Jesse processed those returns) — this was a one-time data patch, not something the next session needs to redo.
2. **FIXED, not yet deployed to production**: Every `fixed inset-0 ... overflow-y-auto` modal in the app (invoice create/edit, rental return, new rental agreement, edit customer, delete-invoice confirm, media lightbox) never locked scroll on the page behind it. On a tall page, dragging the browser's own scrollbar scrolled the hidden background page instead of the modal (which is `position: fixed` and doesn't move with it) — the modal looked stuck no matter how far you scrolled; only Tab-ing through fields worked. Fixed in commit `7c6ac21` with a shared `useLockBodyScroll` hook wired into all 7 modal components.
3. **Not fixed, flagged this session, needs a decision**: 4 Supabase tables have RLS disabled — see §5's security note. Not caused by anything in this session; just never caught before.
4. **Pre-existing lint issues, not blocking, not fixed**: `app/components/EditCustomerButton.tsx` has a `react-hooks/set-state-in-effect` error (calling `setIsOpen(false)` synchronously inside a `useEffect`) and two unescaped-quote `react/no-unescaped-entities` errors. `app/components/MediaLightbox.tsx` has a `<img>`-vs-`next/image` warning. None of these are new — confirmed via `git diff` that recent commits didn't touch those lines. `npx eslint` surfaces them; `next build`'s TypeScript pass does not (lint and typecheck are separate gates here, and only typecheck currently blocks a clean `next build`'s compile step).
5. **Both #1 and #2's fixes are sitting on the working branch, unmerged to `main`.** A third rental unit (MS460, $90/day) was still out as of 2026-10-28, due back "tomorrow" (i.e. around 2026-10-29) — if it got returned with an unpaid pickup charge before the fix reached production, it likely hit the same bug #1 describes and needs the same manual correction. **Check this first** in the new session: query `rentals` for any `Returned` row with `total_owed = 0` and a note mentioning "Deposit refund owed to renter" — that's the bug's signature.

## 11. Decisions made and why

- **One Supabase project hosts two unrelated-ish datasets** (the app's own tables, and the Rotary Cutter parts catalog) rather than splitting them — simplicity of one project/one set of credentials, accepted the mixing.
- **Payment provider is per-invoice, dual (Stripe + Square)**, not picked globally — lets Jesse keep using whichever processor fits a given customer/situation, webhook-verified on both sides, with a manual fallback since webhooks aren't always configured/delivered.
- **Rental late fee is automatic and non-negotiable in code** ($10/day past 5 PM on the end date, per the signed agreement's own Section 4) — there's currently no UI to waive it; if Jesse wants to comp a late fee, that's a direct DB edit today, not an app feature. Worth asking him whether that's worth building.
- **Security deposit is billed together with the rental charge as one combined "pickup charge"** rather than two separate charges — simpler single payment link, but this is exactly what made the return-billing bug (§10 #1) easy to get wrong: the return logic has to know whether that *combined* charge was actually paid before it can treat any part of the deposit as "in hand."
- **The long-lived single working branch + PR-into-main workflow** (rather than a fresh branch per feature) was already established before this session — every round of work lands there, gets reviewed/merged, and the branch continues forward rather than being retired. Preserve this pattern; don't invent a new branch for the next round of work unless Jesse asks for one.
- **Dictation on every notes field** was added specifically because Jesse works out in the field, often one-handed, often on a phone — this is a standing usability priority, not a one-off nice-to-have, worth keeping in mind for any new text-entry UI.
- **The multi-unit rental agreement system was deliberately kept in its own file/table** (`lib/multiUnitRentalAgreement.ts`, `rental_agreements`) rather than folded into the existing per-unit `rentals`/`lib/rentals.ts` system, specifically so changing one's billing rules could never silently change the other's. In practice (per §9) Jesse hasn't actually used the multi-unit path yet, so this separation hasn't been tested against real usage.
- **Never create a GitHub PR without being explicitly asked** — this has come up twice in the current session (the rental-billing fix and the scroll-lock fix both sit unmerged on the working branch because Jesse hadn't yet said "yes, open it" at time of writing). Don't open the PR preemptively; do flag clearly and repeatedly that a fix isn't live until it's merged.

## 12. Jesse's preferences (how we've been working)

See `handoff/memory/preferences.md` for the fuller version. Short version: wants problems root-caused and actually fixed in the app rather than worked around with manual one-off invoices/spreadsheets; is currently in the middle of real customer transactions while reporting bugs (treat these as live-production, real-money issues, not abstract tickets); prefers being told plainly when a fix isn't deployed yet rather than assuming he'll notice; appreciates being walked through exactly which UI buttons to click, not just "it's fixed now."

## 13. Prioritized to-do list

1. **Get the PR open and merged to `main`** for the two already-committed fixes (rental billing §10.1, modal scroll lock §10.2) — both are verified (`tsc`/`eslint`/`next build` compile+typecheck all clean) and just waiting on Jesse's go-ahead to open the PR, per the "ask before opening a PR" rule. This should be the very first thing raised in the new session.
2. **Check whether MS460's return already hit the same billing bug** (§10.5) — query `rentals` for `Returned` rows with `total_owed = 0` and a bogus deposit-refund note; hand-correct the same way MS194T/MS251 were corrected if so.
3. **Surface the RLS-disabled-tables security issue to Jesse** (§5) and get a decision on policies before enabling RLS on `service_customers`/`service_equipment`/`service_parts_list`/`business_documents` (enabling blind will break whatever currently reads them).
4. **Ask Jesse whether the multi-unit rental agreement flow (`rental_agreements`) is something he actually wants to use** — it's unused in practice; either get it exercised for real or consider not investing further in it.
5. Fix the pre-existing lint issues in `EditCustomerButton.tsx` and `MediaLightbox.tsx` (§10.4) — small, low-risk, not urgent.
6. Consider adding a Kohler SH-series row (or rows) to `oem_cross_references` the next time a Kohler-powered unit needs a parts lookup, rather than re-deriving the GX200 cross-reference by hand each time.
7. Decide whether to build a "waive late fee" control for rental returns, or keep it as a manual DB edit (§11).

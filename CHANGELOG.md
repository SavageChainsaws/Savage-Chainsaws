# Changelog

Owned by Stem. One line per change: date, who, what, and why if it's not obvious. Everyone on the team — Claude, Stem, App Bot, New Bot, Financial Bot — checks this file and `docs/HANDOFF.md` before building anything new, and adds a line here for every change they make. Newest entries on top.

Only Claude writes code or runs migrations (see `docs/HANDOFF.md` §7) — an entry here from a bot describes data it entered or an action it took through an existing API route, never a code or schema change.

## 2026-11-09

- **[Claude]** Built App Bot and Financial Bot access: individually-revocable bearer tokens (never stored/logged/committed as plaintext — see `/bot-tokens`), scoped `/api/bot/app/*` and `/api/bot/financial/*` routes, server-side permission enforcement (RLS can't gate a tokenless bot), full audit log (`bot_audit_log`), idempotency-key protection on every mutating endpoint, and duplicate-match safeguards for bot-created customers/units (`lib/bot/rules.ts`'s `resolveMatch()` — ambiguous matches need Jesse's review, never auto-created). Added `invoices.due_date` (no backfill, no assumed NET 30 — Jesse confirms per-invoice at `/invoices`), `service_history.hour_meter`/`.parts_used` (kept separate from labor hours), and a partial unique index on `units(customer_id, serial_number)` excluding placeholder values. Added Vitest and unit tests for the new `lib/bot/*` rules (forbidden actions, duplicate-reminder throttling, idempotent retries, dedup matching). **Migration not yet applied to the live database; routes not yet deployed — pending Jesse's go-ahead (see the PR).**
- **[Claude]** Updated `docs/HANDOFF.md` (§2, §3, §4, §5, §6, §7, §8, quick-start) to describe the above.

## 2026-11-08

- **[Claude]** Added `docs/HANDOFF.md` and this file, for the new multi-bot team (Stem, App Bot, New Bot, Financial Bot) to stay in sync with Claude and each other.
- **[Claude]** Diagnosed invoice SC-0051 (Reliable Lawn Services) showing no PDF to the customer: it hit a since-fixed negative-line-item bug at creation time, so no PDF was ever generated — Jesse texted a screenshot instead. Fix is built, pending his go-ahead to run it.
- **[Claude]** Fixed two missing-`GRANT` bugs (new Supabase tables had the right RLS policy but no base `GRANT SELECT` to `authenticated`/`anon`, so they silently returned empty with no error) on `equipment_spec_sheets` and `reference_guides`/`reference_guide_pages`.
- **[Claude]** Added the Guides & Reference section to the Specs tab — 12 scanned STIHL reference documents (chain ID system, guide bar transitions, gasoline guidelines, oil comparison, QuickCheck diagnostics, the 2024 and 2021 engine-check/technical-reference guides, the dealer tool box price list, HT drive-tube and slip-clutch troubleshooting, TS 500i fuel-injection engine check). New tables: `reference_guides`, `reference_guide_pages`.
- **[Claude]** Added the Specs & Technical Data tab — browsable/searchable STIHL factory carb/torque spec sheet (167 rows, 36-page scan). New table: `equipment_spec_sheets`.
- **[Claude]** Merged PR #128 to `main` (production): rental-return billing fix, modal scroll-lock fix, rental-return PDF-navigation fix, negative-line-item invoice fix.

## Earlier history

Everything before this file existed is described in `docs/HANDOFF.md` §8 (Current State) and the git log on `claude/customer-login-redirect-fix-n1q020`, not reconstructed here.

-- Unit Bot access (see docs/HANDOFF.md) - a third bot scope alongside App
-- Bot and Financial Bot, same pattern: a hashed bearer token in
-- bot_tokens, minted once at /bot-tokens, every call audited to
-- bot_audit_log, Idempotency-Key required on every write, and the same
-- shared rate limiter (lib/bot/rateLimit.ts) now applied to all three bots.
--
-- NOT YET APPLIED to the live database - this file is for review (Stem
-- first, then Jesse's go-ahead) before deploying the /api/bot/unit/*
-- routes, which assume this schema exists. service_role already has full
-- GRANTs on every table here (20261109060000_grant_service_role_access.sql
-- fixed that project-wide), so no new GRANTs are needed in this file.

-- 1. Widen the bot_name check to admit the new scope. Existing app_bot/
-- financial_bot rows and behavior are untouched.
alter table public.bot_tokens drop constraint bot_tokens_bot_name_check;
alter table public.bot_tokens add constraint bot_tokens_bot_name_check
  check (bot_name in ('app_bot', 'financial_bot', 'unit_bot'));

-- 2. service_history needs to know WHICH bot (if any) created a given
-- entry - Unit Bot may only edit an entry it itself created, never one
-- entered by Jesse through the admin UI or by App Bot. NULL means a human
-- admin entered it directly. Backfilled as NULL for every existing row,
-- which is correct: none of them were created by a bot (bot access didn't
-- exist until now).
alter table public.service_history add column created_by_bot_name text
  check (created_by_bot_name is null or created_by_bot_name in ('app_bot', 'unit_bot'));

-- 3. Alternate-vendor parts cross-reference, added to unit_part_overrides
-- rather than to service_parts_list. service_parts_list (one of the four
-- service_customers/service_equipment/service_parts_list/business_documents
-- tables already flagged in docs/HANDOFF.md as an abandoned, unconnected
-- prototype) has RLS disabled and keys off equipment_id - an integer PK
-- belonging to the separate, abandoned service_equipment table, not
-- units.id. There is no way to attach an alt-vendor note to a real unit
-- through it. unit_part_overrides is already unit_id-linked, RLS-enabled,
-- and already has sku/sku_type (OEM vs Aftermarket) - these five columns
-- extend it with the same cross-reference fields the request asked for,
-- attached to something that actually corresponds to a real unit.
alter table public.unit_part_overrides add column rotary_sku text;
alter table public.unit_part_overrides add column rotary_oem_ref text;
alter table public.unit_part_overrides add column alt_vendor text;
alter table public.unit_part_overrides add column alt_part_number text;
alter table public.unit_part_overrides add column alt_notes text;

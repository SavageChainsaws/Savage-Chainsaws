-- App Bot customer creation (see docs/HANDOFF.md) - App Bot may now create
-- a brand-new customer directly (previously it could only read/match
-- existing ones via POST /api/bot/app/customers' old resolveMatch()-based
-- dedup), plus PATCH the contact fields on a customer it itself created.
--
-- NOT YET APPLIED to the live database - this file is for review (Stem
-- first, then Jesse's go-ahead) before deploying the changed
-- /api/bot/app/customers routes, which assume this schema exists.
-- service_role already has full GRANTs on every table here
-- (20261109050851_grant_service_role_access.sql fixed that project-wide),
-- so no new GRANTs are needed in this file.

-- 1. customers needs address/business_name/notes to create a customer with
-- everything the request asked for - confirmed against the live schema
-- that none of these three columns existed before now, so they're added
-- here rather than silently dropping those fields from the request body.
alter table public.customers add column address text;
alter table public.customers add column business_name text;
alter table public.customers add column notes text;

-- 2. customers needs to know WHICH bot (if any) created a given row - App
-- Bot may only PATCH the contact fields on a customer it itself created,
-- never one Jesse entered by hand or one that already has a portal login
-- or other admin-managed state attached. NULL means a human admin created
-- it directly (every existing row, since bot-created customers didn't
-- exist until now) - same pattern as service_history.created_by_bot_name
-- from the Unit Bot PR. Only 'app_bot' is a valid non-null value here -
-- Unit Bot never creates customers (see docs/HANDOFF.md §7) and Financial
-- Bot is read-only everywhere, so neither should ever be able to pass this
-- check even if a future route mistakenly tried to stamp it.
alter table public.customers add column created_by_bot_name text
  check (created_by_bot_name is null or created_by_bot_name = 'app_bot');

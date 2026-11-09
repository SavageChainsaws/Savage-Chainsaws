-- Bot access for App Bot and Financial Bot (see docs/HANDOFF.md).
--
-- NOT YET APPLIED to the live database - this file is for review. Apply it
-- (via the Supabase SQL editor, or the migration tool, with Jesse's
-- explicit go-ahead) before deploying the /api/bot/* routes, which assume
-- this schema exists.
--
-- Each bot authenticates with its own bearer token (see lib/bot/auth.ts),
-- never with a Supabase Auth session - RLS can't gate a bot that has no
-- auth.uid(), so every /api/bot/* route uses the service-role client
-- internally and enforces who-can-do-what in code, after this migration's
-- own token check. The RLS policies below are defense in depth (so the
-- anon/authenticated keys can never read these tables directly, the same
-- as every other admin-only table in this app), not the actual gate.

-- 1. Bot tokens. Only ever stores a SHA-256 hash of the real token - the
-- actual value exists for a few seconds in the admin UI when generated
-- (see app/bot-tokens/page.tsx) and is never written to this table, a log,
-- or anywhere else. Revoking is a soft-delete (revoked_at set) so a
-- compromised token's usage history survives it being cut off.
create table public.bot_tokens (
  id uuid primary key default gen_random_uuid(),
  bot_name text not null check (bot_name in ('app_bot', 'financial_bot')),
  token_hash text not null unique,
  label text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);

alter table public.bot_tokens enable row level security;
create policy "admins full access to bot_tokens" on public.bot_tokens for all using (is_admin());
grant select on public.bot_tokens to authenticated;
grant insert, update, delete on public.bot_tokens to authenticated;

-- 2. Audit log - one row per bot action attempt, including denied ones.
-- `detail` must never contain a token or Authorization header value.
create table public.bot_audit_log (
  id uuid primary key default gen_random_uuid(),
  bot_name text not null,
  action text not null,
  endpoint text not null,
  target_table text,
  target_id text,
  outcome text not null check (outcome in ('success', 'denied', 'error')),
  detail jsonb,
  created_at timestamptz not null default now()
);

create index bot_audit_log_bot_name_created_at_idx on public.bot_audit_log (bot_name, created_at desc);

alter table public.bot_audit_log enable row level security;
create policy "admins full access to bot_audit_log" on public.bot_audit_log for all using (is_admin());
grant select on public.bot_audit_log to authenticated;
grant insert, update, delete on public.bot_audit_log to authenticated;

-- 3. Idempotency keys - a repeated mutating request (same bot, same
-- endpoint, same key) replays the stored response instead of re-running
-- the action, so a bot's retry after a dropped connection can never create
-- a second invoice/service record/customer/unit or send a second reminder.
create table public.bot_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  bot_name text not null,
  endpoint text not null,
  idempotency_key text not null,
  response_status int not null,
  response_body jsonb,
  created_at timestamptz not null default now(),
  unique (bot_name, endpoint, idempotency_key)
);

alter table public.bot_idempotency_keys enable row level security;
create policy "admins full access to bot_idempotency_keys" on public.bot_idempotency_keys for all using (is_admin());
grant select on public.bot_idempotency_keys to authenticated;
grant insert, update, delete on public.bot_idempotency_keys to authenticated;

-- 4. Reminder log - the business-rule throttle (one reminder per invoice
-- every 3 days) lives on this, separate from the idempotency table above,
-- since the throttle is a billing rule App Bot must obey even on a
-- deliberate second call, not just a technical-retry safeguard.
create table public.invoice_reminders (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  sent_at timestamptz not null default now(),
  sent_to text,
  bot_name text not null
);

create index invoice_reminders_invoice_id_sent_at_idx on public.invoice_reminders (invoice_id, sent_at desc);

alter table public.invoice_reminders enable row level security;
create policy "admins full access to invoice_reminders" on public.invoice_reminders for all using (is_admin());
grant select on public.invoice_reminders to authenticated;
grant insert, update, delete on public.invoice_reminders to authenticated;

-- 5. Invoice due dates. No backfill, no assumed NET 30 - existing invoices
-- are left NULL on purpose; a NULL due_date blocks App Bot from sending a
-- reminder for that invoice (see lib/bot/rules.ts) rather than guessing.
-- Jesse sets this per-invoice (admin UI) when he confirms that customer's
-- actual payment terms.
alter table public.invoices add column due_date date;

-- 6. Service record detail - equipment hour-meter reading and parts used,
-- kept on service_history itself (one per visit) rather than only ever
-- overwriting units.hour_meter's single "latest reading" value. This is
-- the physical equipment's running-hours meter, NOT a labor-hours/time-
-- worked field - no labor-hours column exists or should be inferred from
-- this one.
alter table public.service_history add column hour_meter text;
alter table public.service_history add column parts_used jsonb;

-- 7. next_invoice_number() currently gates on is_admin(), which checks
-- auth.uid() against profiles - there is no auth.uid() at all when this is
-- called via the service-role client (every /api/bot/* route's only way to
-- write, since RLS can't gate a bot with no Supabase Auth session - see the
-- top of this file). Widening the gate to also accept the service role
-- preserves the existing behavior for every real admin session exactly
-- (is_admin() is still checked first) while letting a bot route, which has
-- already done its own token check before ever reaching this call, mint a
-- real invoice number through the same sequence everyone else uses.
create or replace function public.next_invoice_number()
returns text
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not (public.is_admin() or auth.role() = 'service_role') then
    raise exception 'Only an admin can generate an invoice number.' using errcode = '42501';
  end if;
  return 'SC-' || lpad(nextval('invoice_number_seq')::text, 4, '0');
end;
$$;

-- 8. Duplicate-unit safeguard. Verified against live data before writing
-- this (2026-11-08): the only existing collisions on (customer_id,
-- serial_number) are placeholder values ("Unknown", "n/a") on real,
-- different physical units - see lib/units.ts's own NON_IDENTIFYING_SERIALS
-- list, which this partial index mirrors exactly. A unit with no real
-- serial on file can still be entered more than once per customer; two
-- rows with the SAME real serial for the same customer cannot.
create unique index units_customer_identifying_serial_key on public.units (customer_id, lower(serial_number))
  where lower(trim(serial_number)) not in ('unknown', 'n/a', 'na', 'none', 'unk', 'tbd', '-', '--', '?');

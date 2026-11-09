-- Hotfix: service_role was bypassing RLS (confirmed via pg_roles.rolbypassrls
-- = true) but had never actually been GRANTed table-level access on
-- anything these bot routes touch - RLS bypass and the underlying GRANT
-- system are two separate layers, and only the RLS layer was ever
-- addressed (20261109000000_bot_access.sql granted `authenticated`, never
-- `service_role`). Confirmed live via Supabase's own edge_logs: every
-- /api/bot/* request's verifyBotToken() SELECT on bot_tokens, and every
-- logBotAction() INSERT on bot_audit_log, came back 403 from PostgREST -
-- not "no row found", an actual permission-denied - which is also why
-- bot_audit_log never got an entry for the very call that was denied: the
-- audit INSERT itself was being rejected the same way.
--
-- The same gap turned out to affect every pre-existing createAdminClient()
-- (service-role) caller in this app too (webhook handlers, customer-login
-- creation, Zelle claim handling, push subscriptions) - not something this
-- PR introduced, just never previously exercised hard enough to surface.
-- Fixed here for the whole schema, not just the four new bot tables, and
-- with ALTER DEFAULT PRIVILEGES so a future new table never silently
-- repeats this - extending the lesson already in docs/HANDOFF.md's Known
-- Issues (a new table needs an explicit GRANT to `authenticated`/`anon`
-- or it silently returns empty) to service_role as well: here it didn't
-- even fail silently, it fails loudly with 403 on every call.
--
-- Safe to run - service_role already bypasses RLS and is already fully
-- trusted by this app's own design (every /api/bot/* route's own comment:
-- "RLS can't gate a bot with no auth.uid(), so permission is enforced in
-- route code" - that was never actually reachable without this).
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all routines in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on routines to service_role;

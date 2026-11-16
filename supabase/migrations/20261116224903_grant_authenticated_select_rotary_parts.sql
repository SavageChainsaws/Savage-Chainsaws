-- Hotfix, applied directly to the live database before this file was
-- committed (same pattern as 20261109050851_grant_service_role_access.sql)
-- - reported live: a real Rotary SKU typed into an invoice Parts line
-- (9212114, a 14" guide bar) never auto-filled, even after fixing
-- /api/parts-catalog/lookup to also query rotary_parts. The real cause
-- wasn't the missing fallback query at all: rotary_parts and
-- oem_cross_references had RLS enabled with an "admins full access"
-- policy (keyed on is_admin()), same as parts_catalog, but were MISSING
-- the table-level GRANT SELECT to the `authenticated` role entirely -
-- parts_catalog had both. Postgres checks GRANTs before RLS, so without
-- it the query is denied outright, not "no rows match" - and this route
-- was silently swallowing that error into a plain `null`, making it look
-- exactly like "the SKU isn't in the catalog." This is the same class of
-- bug as 20260926153849/20260927104709/20260927104755's "fix_missing_*_
-- grants" migrations and 20261109050851's service_role incident - RLS and
-- GRANTs are two separate layers, and enabling RLS with a policy is not
-- enough on its own.
grant select on public.rotary_parts to authenticated;
grant select on public.oem_cross_references to authenticated;

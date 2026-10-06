-- Explicit privileges for service_role (server-only key: admin scripts such as
-- create-manager / demo-data and manager-verified invites).
--
-- Locally and on most projects service_role already has these through
-- Supabase's default privileges; newer projects may not grant them to new
-- tables automatically, so they are stated explicitly here. service_role
-- bypasses RLS; it is never used in user-facing code paths (see CLAUDE.md).

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges for role postgres in schema public grant all on tables to service_role;
alter default privileges for role postgres in schema public grant all on sequences to service_role;
alter default privileges for role postgres in schema public grant execute on functions to service_role;

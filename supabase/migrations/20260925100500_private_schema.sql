-- Schema "private" for internal helpers (security definer functions used by RLS policies, triggers and cron).
-- Not exposed through the API. (This step was applied straight to the first database on 25 Sep as
-- "move_role_helpers_private" and was missing from the repo — re-created here so a fresh project builds.)
create schema if not exists private;
grant usage on schema private to anon, authenticated, service_role;

create or replace function private.current_role_name() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid()) and is_active
$$;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.current_role_name() = 'admin', false)
$$;

-- Point the first policies at the private helpers and remove the public copies.
drop policy if exists "teams admin write" on public.teams;
create policy "teams admin write" on public.teams
  for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

drop function if exists public.is_admin();
drop function if exists public.current_role_name();

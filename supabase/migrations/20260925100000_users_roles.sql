-- =====================================================================
-- Step 1: Users, roles, teams and permissions
-- Run once in Supabase Dashboard -> SQL Editor.
-- =====================================================================

-- Roles --------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('admin', 'manager', 'team_member');
exception when duplicate_object then null; end $$;

-- Teams --------------------------------------------------------------
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- Profiles (one row per login in auth.users) -------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  phone text,                      -- used later for WhatsApp notifications (Wati)
  role public.user_role not null default 'team_member',
  team_id uuid references public.teams(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_team_idx on public.profiles(team_id);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Helper functions used by RLS policies ------------------------------
-- security definer so they can read profiles without recursive RLS checks
create or replace function public.current_role_name() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() = 'admin', false)
$$;

-- Row Level Security -------------------------------------------------
alter table public.teams enable row level security;
alter table public.profiles enable row level security;

-- Teams: every logged-in user can see teams; only admins change them.
drop policy if exists "teams read" on public.teams;
create policy "teams read" on public.teams
  for select to authenticated using (true);

drop policy if exists "teams admin write" on public.teams;
create policy "teams admin write" on public.teams
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Profiles: every logged-in user can see everyone (anyone can assign to anyone).
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles
  for select to authenticated using (true);

-- Users may edit only their own name and phone. Role, team, email and
-- active flag are changed by admins through the admin-users Edge Function.
drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

-- =====================================================================
-- FIRST ADMIN (run once, after creating yourself in
-- Authentication -> Users -> Add user, with "Auto Confirm User" ticked).
-- Replace the email below with the one you used:
--
-- insert into public.profiles (id, full_name, email, role)
-- select id, 'Harsh', email, 'admin' from auth.users
-- where email = 'you@example.com'
-- on conflict (id) do update set role = 'admin', is_active = true;
-- =====================================================================

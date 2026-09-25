-- Simple table to prove the browser can read from Supabase.
create table if not exists public.health_check (
  id bigint generated always as identity primary key,
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.health_check enable row level security;

-- Anyone (including logged-out visitors) may read this one test table.
drop policy if exists "health_check public read" on public.health_check;
create policy "health_check public read"
  on public.health_check for select
  to anon, authenticated
  using (true);

insert into public.health_check (message) values ('Supabase database is reachable');

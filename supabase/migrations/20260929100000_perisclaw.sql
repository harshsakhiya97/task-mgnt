-- =====================================================================
-- v1.2 Perisclaw: tasks from a Google Sheet that Perisclaw writes to.
-- The Edge Function `perisclaw-sync` reads the sheet (shared as "anyone with
-- the link can view"), sends each NEW row to Gemini to pick out the
-- assignee, task, date/time and priority, and creates the task. Rows it
-- isn't sure about wait in "Needs review" for an admin.
-- =====================================================================

-- One settings row (id = 1).
create table public.perisclaw_settings (
  id int primary key default 1 check (id = 1),
  sheet_url text,
  sheet_id text,
  sheet_gid text not null default '0',
  enabled boolean not null default false,
  assigner_id uuid references public.profiles(id),     -- tasks are created as this admin
  import_existing boolean not null default false,      -- false: rows already in the sheet when it's connected are skipped
  baseline_done boolean not null default false,        -- set after the first read of a newly connected sheet
  last_checked_at timestamptz,
  last_error text,
  last_result text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
insert into public.perisclaw_settings (id) values (1);

-- Every sheet row the app has seen, and what happened to it.
create table public.perisclaw_entries (
  id uuid primary key default gen_random_uuid(),
  row_hash text not null unique,                        -- same row content is never processed twice
  row_number int,
  raw jsonb not null,                                   -- {column header: cell value}
  raw_text text not null,
  status text not null default 'processing'
    check (status in ('processing', 'created', 'needs_review', 'ignored', 'skipped_existing', 'error')),
  parsed jsonb,                                         -- what Gemini understood
  reason text,                                          -- why it needs review / error text
  task_id uuid references public.tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  reviewed_by uuid references public.profiles(id)
);
create index perisclaw_entries_created_idx on public.perisclaw_entries (created_at desc);
create index perisclaw_entries_status_idx on public.perisclaw_entries (status);

alter table public.perisclaw_settings enable row level security;
alter table public.perisclaw_entries enable row level security;
create policy "perisclaw settings admin read" on public.perisclaw_settings for select to authenticated using ((select private.is_admin()));
create policy "perisclaw settings admin update" on public.perisclaw_settings for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "perisclaw entries admin read" on public.perisclaw_entries for select to authenticated using ((select private.is_admin()));
create policy "perisclaw entries admin update" on public.perisclaw_entries for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
revoke all on public.perisclaw_settings, public.perisclaw_entries from anon;
revoke insert, delete on public.perisclaw_settings, public.perisclaw_entries from authenticated;
grant select, update on public.perisclaw_settings, public.perisclaw_entries to authenticated;

-- Settings: pull the sheet id / tab id out of the pasted link; a new sheet starts a new baseline.
create or replace function private.perisclaw_settings_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m text[];
begin
  new.id := 1;
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  if new.sheet_url is distinct from old.sheet_url then
    new.sheet_url := nullif(btrim(new.sheet_url), '');
    if new.sheet_url is null then
      new.sheet_id := null; new.enabled := false;
    else
      m := regexp_match(new.sheet_url, '^https://docs\.google\.com/spreadsheets/d/([A-Za-z0-9_-]{20,})');
      if m is null then raise exception 'Paste the full Google Sheet link (https://docs.google.com/spreadsheets/d/…)'; end if;
      new.sheet_id := m[1];
      m := regexp_match(new.sheet_url, '[#?&]gid=([0-9]+)');
      new.sheet_gid := coalesce(m[1], '0');
    end if;
    new.baseline_done := false;
    new.last_error := null;
    new.last_result := null;
  end if;
  if new.enabled and new.sheet_id is null then raise exception 'Add the Google Sheet link first'; end if;
  if new.assigner_id is distinct from old.assigner_id and new.assigner_id is not null and not exists (
       select 1 from public.profiles p join public.roles r on r.id = p.role_id
        where p.id = new.assigner_id and p.is_active and r.is_admin) then
    raise exception 'Tasks must be created as an active admin';
  end if;
  return new;
end $$;

create trigger perisclaw_settings_before before update on public.perisclaw_settings
  for each row execute function private.perisclaw_settings_before();

-- Entries: admins may only change the review fields (status ignored / created by hand).
create or replace function private.perisclaw_entries_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null then
    if new.status not in ('ignored', 'created') or old.status not in ('needs_review', 'error', 'ignored') then
      raise exception 'Only rows that need review can be changed';
    end if;
    new.row_hash := old.row_hash; new.raw := old.raw; new.raw_text := old.raw_text;
    new.row_number := old.row_number; new.parsed := old.parsed; new.created_at := old.created_at;
    new.reviewed_by := (select auth.uid());
    new.processed_at := now();
    if new.status = 'created' and (new.task_id is null or not exists (select 1 from public.tasks where id = new.task_id)) then
      raise exception 'Link the created task';
    end if;
  end if;
  return new;
end $$;

create trigger perisclaw_entries_guard before update on public.perisclaw_entries
  for each row execute function private.perisclaw_entries_guard();

-- Every 2 minutes (only when switched on), ask the Edge Function to check the sheet.
create or replace function private.perisclaw_kick() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.perisclaw_settings where enabled and sheet_id is not null) then
    perform net.http_post(
      url := 'https://tazlvzjalhxsudceabqy.supabase.co/functions/v1/perisclaw-sync',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 60000);
  end if;
end $$;

select cron.schedule('perisclaw-sync', '*/2 * * * *', $$select private.perisclaw_kick()$$);

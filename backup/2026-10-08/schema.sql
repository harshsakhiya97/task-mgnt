-- Task Mgnt — full schema = every migration in supabase/migrations, in order (generated 8 Oct 2026).

-- ===== supabase/migrations/20260925000000_health_check.sql =====
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

-- ===== supabase/migrations/20260925100000_users_roles.sql =====
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

-- ===== supabase/migrations/20260925120000_tasks.sql =====
-- =====================================================================
-- Step 2: Tasks (ad hoc), comments, attachments, activity log
-- Visibility: assigner, assignee and admins. "Manager" has no extra rights.
-- =====================================================================

do $$ begin
  create type public.task_status as enum ('todo', 'in_progress', 'done', 'blocked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');
exception when duplicate_object then null; end $$;

-- Tasks --------------------------------------------------------------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  task_no bigint generated always as identity (start with 101) unique,
  title text not null check (length(trim(title)) > 0),
  description text,
  assigned_by uuid not null references public.profiles(id),
  assigned_to uuid not null references public.profiles(id),
  due_date date,
  priority public.task_priority not null default 'medium',
  status public.task_status not null default 'todo',
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes >= 0),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_assigned_to_idx on public.tasks(assigned_to, status, due_date);
create index if not exists tasks_assigned_by_idx on public.tasks(assigned_by);

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index if not exists task_comments_task_idx on public.task_comments(task_id, created_at);

create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id),
  file_path text not null unique,        -- path inside the task-files bucket: <task_id>/<uuid>-<name>
  file_name text not null,
  size_bytes bigint,
  created_at timestamptz not null default now()
);
create index if not exists task_attachments_task_idx on public.task_attachments(task_id);

create table if not exists public.task_activity (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null,                  -- created | status | assigned_to | due_date | priority | title | comment | attachment
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);
create index if not exists task_activity_task_idx on public.task_activity(task_id, created_at);

-- Helpers ------------------------------------------------------------
create or replace function private.can_see_task(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks
    where id = t and ((select auth.uid()) in (assigned_by, assigned_to) or private.is_admin())
  )
$$;

create or replace function private.can_edit_task(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks
    where id = t and (assigned_by = (select auth.uid()) or private.is_admin())
  )
$$;

-- Triggers: timestamps, completion, edit rules, activity log ---------
create or replace function private.tasks_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    -- The assignee (if not assigner/admin) may change only status and estimate.
    if (select auth.uid()) is not null
       and (select auth.uid()) <> old.assigned_by
       and not private.is_admin() then
      if new.title is distinct from old.title
         or new.description is distinct from old.description
         or new.assigned_to is distinct from old.assigned_to
         or new.assigned_by is distinct from old.assigned_by
         or new.due_date is distinct from old.due_date
         or new.priority is distinct from old.priority then
        raise exception 'Only the person who assigned this task (or an admin) can change its details';
      end if;
    end if;
    new.assigned_by := old.assigned_by;           -- never changes after creation
    new.updated_at := now();
  end if;

  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;

  -- Assignee must be an active user.
  if not exists (select 1 from public.profiles where id = new.assigned_to and is_active) then
    raise exception 'Tasks can only be assigned to active users';
  end if;
  return new;
end $$;

drop trigger if exists tasks_before_write on public.tasks;
create trigger tasks_before_write before insert or update on public.tasks
  for each row execute function private.tasks_before_write();

create or replace function private.tasks_log_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    insert into public.task_activity (task_id, actor_id, action, new_value)
    values (new.id, coalesce(actor, new.assigned_by), 'created', new.title);
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.task_activity (task_id, actor_id, action, old_value, new_value)
    values (new.id, actor, 'status', old.status::text, new.status::text);
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.task_activity (task_id, actor_id, action, old_value, new_value)
    values (new.id, actor, 'assigned_to',
      (select full_name from public.profiles where id = old.assigned_to),
      (select full_name from public.profiles where id = new.assigned_to));
  end if;
  if new.due_date is distinct from old.due_date then
    insert into public.task_activity (task_id, actor_id, action, old_value, new_value)
    values (new.id, actor, 'due_date', old.due_date::text, new.due_date::text);
  end if;
  if new.priority is distinct from old.priority then
    insert into public.task_activity (task_id, actor_id, action, old_value, new_value)
    values (new.id, actor, 'priority', old.priority::text, new.priority::text);
  end if;
  if new.title is distinct from old.title then
    insert into public.task_activity (task_id, actor_id, action, old_value, new_value)
    values (new.id, actor, 'title', old.title, new.title);
  end if;
  return new;
end $$;

drop trigger if exists tasks_log_activity on public.tasks;
create trigger tasks_log_activity after insert or update on public.tasks
  for each row execute function private.tasks_log_activity();

create or replace function private.child_log_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'task_comments' then
    insert into public.task_activity (task_id, actor_id, action, new_value)
    values (new.task_id, new.author_id, 'comment', left(new.body, 120));
  else
    insert into public.task_activity (task_id, actor_id, action, new_value)
    values (new.task_id, new.uploaded_by, 'attachment', new.file_name);
  end if;
  return new;
end $$;

drop trigger if exists task_comments_log on public.task_comments;
create trigger task_comments_log after insert on public.task_comments
  for each row execute function private.child_log_activity();
drop trigger if exists task_attachments_log on public.task_attachments;
create trigger task_attachments_log after insert on public.task_attachments
  for each row execute function private.child_log_activity();

-- Row Level Security -------------------------------------------------
alter table public.tasks enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_attachments enable row level security;
alter table public.task_activity enable row level security;

create policy "tasks read" on public.tasks for select to authenticated
  using ((select auth.uid()) in (assigned_by, assigned_to) or (select private.is_admin()));
create policy "tasks create" on public.tasks for insert to authenticated
  with check (assigned_by = (select auth.uid()) and (select private.current_role_name()) is not null);
create policy "tasks update" on public.tasks for update to authenticated
  using ((select auth.uid()) in (assigned_by, assigned_to) or (select private.is_admin()))
  with check ((select auth.uid()) in (assigned_by, assigned_to) or (select private.is_admin()));
create policy "tasks delete" on public.tasks for delete to authenticated
  using (assigned_by = (select auth.uid()) or (select private.is_admin()));

create policy "comments read" on public.task_comments for select to authenticated
  using ((select private.can_see_task(task_id)));
create policy "comments create" on public.task_comments for insert to authenticated
  with check (author_id = (select auth.uid()) and (select private.can_see_task(task_id)));
create policy "comments delete own" on public.task_comments for delete to authenticated
  using (author_id = (select auth.uid()) or (select private.is_admin()));

create policy "attachments read" on public.task_attachments for select to authenticated
  using ((select private.can_see_task(task_id)));
create policy "attachments create" on public.task_attachments for insert to authenticated
  with check (uploaded_by = (select auth.uid()) and (select private.can_see_task(task_id)));
create policy "attachments delete" on public.task_attachments for delete to authenticated
  using (uploaded_by = (select auth.uid()) or (select private.can_edit_task(task_id)));

create policy "activity read" on public.task_activity for select to authenticated
  using ((select private.can_see_task(task_id)));
-- (activity rows are written only by triggers)

revoke all on public.tasks, public.task_comments, public.task_attachments, public.task_activity from anon;

-- File storage -------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('task-files', 'task-files', false, 10485760)   -- 10 MB per file
on conflict (id) do update set public = false, file_size_limit = 10485760;

create policy "task files read" on storage.objects for select to authenticated
  using (bucket_id = 'task-files' and (select private.can_see_task(((storage.foldername(name))[1])::uuid)));
create policy "task files upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'task-files' and (select private.can_see_task(((storage.foldername(name))[1])::uuid)));
create policy "task files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'task-files' and (owner_id = (select auth.uid())::text
         or (select private.can_edit_task(((storage.foldername(name))[1])::uuid))));

-- ===== supabase/migrations/20260925130000_task_reassign.sql =====
-- =====================================================================
-- Re-assignment (delegation) of tasks
--   created_by   = original creator, never changes
--   assigned_by  = whoever handed the task to the current assignee
--   assigned_to  = current assignee
--   participants = everyone who has ever created / passed on / held the task
-- Everyone in `participants` keeps seeing the task:
--   current assignee -> "Assigned to Me"; everyone else -> "Assigned by Me".
-- =====================================================================

alter table public.tasks add column if not exists created_by uuid references public.profiles(id);
alter table public.tasks add column if not exists participants uuid[] not null default '{}';
update public.tasks set created_by = assigned_by where created_by is null;
update public.tasks set participants = array(select distinct unnest(array[created_by, assigned_by, assigned_to]))
  where participants = '{}';
alter table public.tasks alter column created_by set not null;
create index if not exists tasks_participants_idx on public.tasks using gin (participants);

-- Visibility helper now uses participants.
create or replace function private.can_see_task(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks
    where id = t and ((select auth.uid()) = any(participants) or private.is_admin())
  )
$$;

-- "Can edit details" = creator or admin.
create or replace function private.can_edit_task(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks
    where id = t and (created_by = (select auth.uid()) or private.is_admin())
  )
$$;

create or replace function private.tasks_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  admin boolean := private.is_admin();
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(actor, new.assigned_by);
    new.assigned_by := new.created_by;
  else
    new.created_by := old.created_by;                   -- never changes

    if actor is not null and not admin then
      -- Details: only the creator.
      if actor <> old.created_by and (
           new.title is distinct from old.title
        or new.description is distinct from old.description
        or new.due_date is distinct from old.due_date
        or new.priority is distinct from old.priority) then
        raise exception 'Only the person who created this task (or an admin) can change its details';
      end if;
      -- Re-assign: creator, current assignee, or whoever assigned it to them.
      if new.assigned_to is distinct from old.assigned_to
         and actor not in (old.created_by, old.assigned_to, old.assigned_by) then
        raise exception 'Only the current assignee, the person who assigned it, or the creator can reassign this task';
      end if;
    end if;

    if new.assigned_to is distinct from old.assigned_to then
      new.assigned_by := coalesce(actor, old.assigned_by);   -- the person passing it on
      if new.status = 'done' then new.status := 'todo'; end if;  -- fresh start for the new assignee
    else
      new.assigned_by := old.assigned_by;
    end if;
    new.updated_at := now();
  end if;

  new.participants := array(
    select distinct u from unnest(coalesce(old.participants, '{}') || array[new.created_by, new.assigned_by, new.assigned_to]) u
    where u is not null
  );

  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;

  if (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not exists (select 1 from public.profiles where id = new.assigned_to and is_active) then
    raise exception 'Tasks can only be assigned to active users';
  end if;
  return new;
end $$;

-- RLS: participants (or admin) can see and update; creator (or admin) can delete.
drop policy if exists "tasks read" on public.tasks;
create policy "tasks read" on public.tasks for select to authenticated
  using ((select auth.uid()) = any(participants) or (select private.is_admin()));

drop policy if exists "tasks update" on public.tasks;
create policy "tasks update" on public.tasks for update to authenticated
  using ((select auth.uid()) = any(participants) or (select private.is_admin()))
  with check ((select auth.uid()) = any(participants) or (select private.is_admin()));

drop policy if exists "tasks delete" on public.tasks;
create policy "tasks delete" on public.tasks for delete to authenticated
  using (created_by = (select auth.uid()) or (select private.is_admin()));

-- ===== supabase/migrations/20260925140000_task_new_badge.sql =====
-- =====================================================================
-- "New" badge + "Reassigned" tag
--   assigned_at : when the current assignee received the task
--   reassigned  : true if the current assignee got it through a handover
--   seen_at     : when the current assignee first opened it (null = New)
-- =====================================================================

alter table public.tasks add column if not exists assigned_at timestamptz;
alter table public.tasks add column if not exists reassigned boolean not null default false;
alter table public.tasks add column if not exists seen_at timestamptz;
update public.tasks set assigned_at = coalesce(assigned_at, created_at);
update public.tasks set reassigned = true where assigned_by <> created_by;
update public.tasks set seen_at = now() where seen_at is null;   -- existing tasks: not "new"
alter table public.tasks alter column assigned_at set not null;
alter table public.tasks alter column assigned_at set default now();

create or replace function private.tasks_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  admin boolean := private.is_admin();
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(actor, new.assigned_by);
    new.assigned_by := new.created_by;
    new.assigned_at := now();
    new.reassigned := false;
    -- A task you give yourself isn't "new" to you.
    new.seen_at := case when new.assigned_to = new.created_by then now() else null end;
  else
    new.created_by := old.created_by;

    if actor is not null and not admin then
      if actor <> old.created_by and (
           new.title is distinct from old.title
        or new.description is distinct from old.description
        or new.due_date is distinct from old.due_date
        or new.priority is distinct from old.priority) then
        raise exception 'Only the person who created this task (or an admin) can change its details';
      end if;
      if new.assigned_to is distinct from old.assigned_to
         and actor not in (old.created_by, old.assigned_to, old.assigned_by) then
        raise exception 'Only the current assignee, the person who assigned it, or the creator can reassign this task';
      end if;
      -- Only the current assignee can mark it as seen.
      if new.seen_at is distinct from old.seen_at and new.assigned_to is not distinct from old.assigned_to
         and actor <> old.assigned_to then
        new.seen_at := old.seen_at;
      end if;
    end if;

    if new.assigned_to is distinct from old.assigned_to then
      new.assigned_by := coalesce(actor, old.assigned_by);
      new.assigned_at := now();
      new.reassigned := true;
      new.seen_at := case when new.assigned_to = actor then now() else null end;
      if new.status = 'done' then new.status := 'todo'; end if;
    else
      new.assigned_by := old.assigned_by;
      new.assigned_at := old.assigned_at;
      new.reassigned := old.reassigned;
    end if;

    -- Any action by the assignee (e.g. changing status from the list) means they've seen it.
    if new.seen_at is null and actor is not null and actor = new.assigned_to
       and new.assigned_to is not distinct from old.assigned_to then
      new.seen_at := now();
    end if;

    -- Opening a task (seen_at only) shouldn't count as an edit.
    if row(new.title, new.description, new.due_date, new.priority, new.status, new.assigned_to, new.estimated_minutes)
       is distinct from row(old.title, old.description, old.due_date, old.priority, old.status, old.assigned_to, old.estimated_minutes) then
      new.updated_at := now();
    else
      new.updated_at := old.updated_at;
    end if;
  end if;

  new.participants := array(
    select distinct u from unnest(coalesce(old.participants, '{}') || array[new.created_by, new.assigned_by, new.assigned_to]) u
    where u is not null
  );

  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;

  if (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not exists (select 1 from public.profiles where id = new.assigned_to and is_active) then
    raise exception 'Tasks can only be assigned to active users';
  end if;
  return new;
end $$;

-- ===== supabase/migrations/20260925150000_drop_estimated_time.sql =====
-- =====================================================================
-- Remove "estimated time" from tasks (decided 25 Sep 2026)
-- =====================================================================

create or replace function private.tasks_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  admin boolean := private.is_admin();
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(actor, new.assigned_by);
    new.assigned_by := new.created_by;
    new.assigned_at := now();
    new.reassigned := false;
    -- A task you give yourself isn't "new" to you.
    new.seen_at := case when new.assigned_to = new.created_by then now() else null end;
  else
    new.created_by := old.created_by;

    if actor is not null and not admin then
      if actor <> old.created_by and (
           new.title is distinct from old.title
        or new.description is distinct from old.description
        or new.due_date is distinct from old.due_date
        or new.priority is distinct from old.priority) then
        raise exception 'Only the person who created this task (or an admin) can change its details';
      end if;
      if new.assigned_to is distinct from old.assigned_to
         and actor not in (old.created_by, old.assigned_to, old.assigned_by) then
        raise exception 'Only the current assignee, the person who assigned it, or the creator can reassign this task';
      end if;
      -- Only the current assignee can mark it as seen.
      if new.seen_at is distinct from old.seen_at and new.assigned_to is not distinct from old.assigned_to
         and actor <> old.assigned_to then
        new.seen_at := old.seen_at;
      end if;
    end if;

    if new.assigned_to is distinct from old.assigned_to then
      new.assigned_by := coalesce(actor, old.assigned_by);
      new.assigned_at := now();
      new.reassigned := true;
      new.seen_at := case when new.assigned_to = actor then now() else null end;
      if new.status = 'done' then new.status := 'todo'; end if;
    else
      new.assigned_by := old.assigned_by;
      new.assigned_at := old.assigned_at;
      new.reassigned := old.reassigned;
    end if;

    -- Any action by the assignee (e.g. changing status from the list) means they've seen it.
    if new.seen_at is null and actor is not null and actor = new.assigned_to
       and new.assigned_to is not distinct from old.assigned_to then
      new.seen_at := now();
    end if;

    -- Opening a task (seen_at only) shouldn't count as an edit.
    if row(new.title, new.description, new.due_date, new.priority, new.status, new.assigned_to)
       is distinct from row(old.title, old.description, old.due_date, old.priority, old.status, old.assigned_to) then
      new.updated_at := now();
    else
      new.updated_at := old.updated_at;
    end if;
  end if;

  new.participants := array(
    select distinct u from unnest(coalesce(old.participants, '{}') || array[new.created_by, new.assigned_by, new.assigned_to]) u
    where u is not null
  );

  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;

  if (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not exists (select 1 from public.profiles where id = new.assigned_to and is_active) then
    raise exception 'Tasks can only be assigned to active users';
  end if;
  return new;
end $$;

alter table public.tasks drop column if exists estimated_minutes;

-- ===== supabase/migrations/20260925160000_notifications.sql =====
-- =====================================================================
-- In-app notifications
--  1. New task / reassignment -> the new assignee ("A has assigned X to you")
--                              -> all admins     ("A has assigned X to B")
--  2. Action by the current assignee (comment, status change, edit, file,
--     reassignment) -> the assigner (whoever handed it to them) + all admins
--  Nobody is notified about their own action. Each person gets at most one
--  notification per event.
-- =====================================================================

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  type text not null,            -- assigned | reassigned | status | comment | attachment | updated
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications(user_id) where read_at is null;

alter table public.notifications enable row level security;
create policy "notifications own read" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "notifications own mark read" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "notifications own delete" on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.notifications from anon;
revoke insert, update on public.notifications from authenticated;   -- only triggers create them
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Live updates in the browser
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- Helpers -------------------------------------------------------------
create or replace function private.person_name(p uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select full_name from public.profiles where id = p), 'Someone')
$$;

-- Send one notification to each recipient (skips nulls, the actor and duplicates).
create or replace function private.notify(recipients uuid[], p_task uuid, p_actor uuid, p_type text, p_message text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, task_id, actor_id, type, message)
  select distinct r, p_task, p_actor, p_type, p_message
  from unnest(recipients) r
  where r is not null and r is distinct from p_actor
    and exists (select 1 from public.profiles where id = r and is_active)
$$;

create or replace function private.active_admins() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(id), '{}') from public.profiles where role = 'admin' and is_active
$$;

create or replace function private.status_label(s text) returns text
language sql immutable set search_path = '' as $$
  select case s when 'todo' then 'To Do' when 'in_progress' then 'In Progress'
                when 'done' then 'Done' when 'blocked' then 'Blocked' else s end
$$;

-- Task created / updated ------------------------------------------------
create or replace function private.tasks_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := coalesce((select auth.uid()), case when tg_op = 'INSERT' then new.created_by end);
  who text;
  t text := '"' || new.title || '"';
  admins uuid[] := private.active_admins();
  by_assignee boolean;
  changes text[] := '{}';
begin
  if actor is null then return new; end if;           -- system/SQL changes: no notifications
  who := private.person_name(actor);

  -- 1. New task
  if tg_op = 'INSERT' then
    perform private.notify(array[new.assigned_to], new.id, actor, 'assigned', who || ' has assigned ' || t || ' to you');
    perform private.notify(array(select unnest(admins) except select new.assigned_to), new.id, actor, 'assigned',
      who || ' has assigned ' || t || ' to ' || private.person_name(new.assigned_to));
    return new;
  end if;

  by_assignee := actor = old.assigned_to;

  -- 1b. Reassignment
  if new.assigned_to is distinct from old.assigned_to then
    perform private.notify(array[new.assigned_to], new.id, actor, 'reassigned', who || ' has assigned ' || t || ' to you');
    perform private.notify(
      array(select unnest(admins || case when by_assignee then array[old.assigned_by] else '{}'::uuid[] end)
            except select new.assigned_to),
      new.id, actor, 'reassigned', who || ' has reassigned ' || t || ' to ' || private.person_name(new.assigned_to));
    return new;
  end if;

  -- 2. Other changes made by the current assignee -> assigner + admins
  if not by_assignee then return new; end if;

  if new.status is distinct from old.status then
    perform private.notify(admins || new.assigned_by, new.id, actor, 'status',
      who || ' changed the status of ' || t || ' to ' || private.status_label(new.status::text));
  end if;

  if new.title is distinct from old.title then changes := changes || 'title'::text; end if;
  if new.description is distinct from old.description then changes := changes || 'description'::text; end if;
  if new.due_date is distinct from old.due_date then changes := changes || 'due date'::text; end if;
  if new.priority is distinct from old.priority then changes := changes || 'priority'::text; end if;
  if array_length(changes, 1) > 0 then
    perform private.notify(admins || new.assigned_by, new.id, actor, 'updated',
      who || ' updated the ' || array_to_string(changes, ', ') || ' of ' || t);
  end if;
  return new;
end $$;

drop trigger if exists tasks_notify on public.tasks;
create trigger tasks_notify after insert or update on public.tasks
  for each row execute function private.tasks_notify();

-- Comments & attachments by the current assignee -> assigner + admins ---
create or replace function private.child_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  tk record;
  actor uuid;
  msg text;
begin
  select id, title, assigned_to, assigned_by into tk from public.tasks where id = new.task_id;
  if tg_table_name = 'task_comments' then
    actor := new.author_id;
    msg := private.person_name(actor) || ' commented on "' || tk.title || '": ' ||
           case when length(new.body) > 80 then left(new.body, 80) || '…' else new.body end;
  else
    actor := new.uploaded_by;
    msg := private.person_name(actor) || ' attached ' || new.file_name || ' to "' || tk.title || '"';
  end if;

  if actor = tk.assigned_to then
    perform private.notify(private.active_admins() || tk.assigned_by, tk.id, actor,
      case when tg_table_name = 'task_comments' then 'comment' else 'attachment' end, msg);
  end if;
  return new;
end $$;

drop trigger if exists task_comments_notify on public.task_comments;
create trigger task_comments_notify after insert on public.task_comments
  for each row execute function private.child_notify();
drop trigger if exists task_attachments_notify on public.task_attachments;
create trigger task_attachments_notify after insert on public.task_attachments
  for each row execute function private.child_notify();

-- ===== supabase/migrations/20260925170000_recurring_and_time_blocks.sql =====
-- =====================================================================
-- Task type (ad hoc / recurring), recurring templates with a nightly
-- generator, and calendar time blocks.
--
-- Ad hoc task    : one task with a due date.
-- Recurring task : a template (recurring_tasks) with chosen weekdays. Each
--                  chosen day a normal task ("occurrence") is created for the
--                  assignee, due that day. Unfinished occurrences stay open
--                  (shown as Expired) until done - i.e. they carry over.
-- Time blocks    : a person's planned time (any length) for a task or for
--                  anything else ("Client meeting"). Admins can view all.
-- =====================================================================

-- ---------- Recurring templates ----------
create table if not exists public.recurring_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  description text,
  priority public.task_priority not null default 'medium',
  created_by uuid not null references public.profiles(id),
  assigned_to uuid not null references public.profiles(id),
  weekdays smallint[] not null check (cardinality(weekdays) > 0 and weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),  -- 0 = Sunday
  start_date date not null default ((now() at time zone 'Asia/Kolkata')::date),
  end_date date check (end_date is null or end_date >= start_date),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recurring_tasks_assignee_idx on public.recurring_tasks(assigned_to);

-- ---------- Tasks: type + link to template ----------
alter table public.tasks add column if not exists task_type text not null default 'adhoc'
  check (task_type in ('adhoc', 'recurring'));
alter table public.tasks add column if not exists recurring_id uuid references public.recurring_tasks(id) on delete set null;
alter table public.tasks add column if not exists occurrence_date date;
create unique index if not exists tasks_one_occurrence_per_day on public.tasks(recurring_id, occurrence_date)
  where recurring_id is not null;

-- ---------- Helpers ----------
create or replace function private.today_ist() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

create or replace function private.weekday_names(d smallint[]) returns text
language sql immutable set search_path = '' as $$
  select case
    when d @> array[0,1,2,3,4,5,6]::smallint[] then 'every day'
    when d @> array[1,2,3,4,5,6]::smallint[] and not d @> array[0]::smallint[] then 'Mon–Sat'
    when d @> array[1,2,3,4,5]::smallint[] and not d && array[0,6]::smallint[] then 'Mon–Fri'
    else (select string_agg((array['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[x + 1], ', ' order by x) from unnest(d) x)
  end
$$;

-- Create the occurrences due on p_date (all templates, or just one). Safe to run repeatedly.
create or replace function private.generate_recurring(p_date date default null, p_template uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare d date := coalesce(p_date, private.today_ist()); n integer;
begin
  insert into public.tasks (title, description, priority, assigned_by, assigned_to, due_date,
                            task_type, recurring_id, occurrence_date)
  select r.title, r.description, r.priority, r.created_by, r.assigned_to, d,
         'recurring', r.id, d
  from public.recurring_tasks r
  join public.profiles p on p.id = r.assigned_to and p.is_active
  where r.is_active
    and (p_template is null or r.id = p_template)
    and d >= r.start_date and (r.end_date is null or d <= r.end_date)
    and extract(dow from d)::smallint = any(r.weekdays)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- Template triggers ----------
create or replace function private.recurring_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(actor, new.created_by);
  else
    new.created_by := old.created_by;
    new.updated_at := now();
  end if;
  new.weekdays := array(select distinct x from unnest(new.weekdays) x order by x);
  if (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not exists (select 1 from public.profiles where id = new.assigned_to and is_active) then
    raise exception 'Tasks can only be assigned to active users';
  end if;
  return new;
end $$;

drop trigger if exists recurring_before_write on public.recurring_tasks;
create trigger recurring_before_write before insert or update on public.recurring_tasks
  for each row execute function private.recurring_before_write();

create or replace function private.recurring_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := coalesce((select auth.uid()), new.created_by);
  who text := private.person_name(actor);
  t text := '"' || new.title || '"';
  days text := private.weekday_names(new.weekdays);
begin
  -- Create today's occurrence straight away if today is one of the chosen days.
  perform private.generate_recurring(private.today_ist(), new.id);

  if tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to then
    perform private.notify(array[new.assigned_to], null, actor, 'assigned',
      who || ' has assigned recurring task ' || t || ' (' || days || ') to you');
    perform private.notify(array(select unnest(private.active_admins()) except select new.assigned_to), null, actor, 'assigned',
      who || ' has assigned recurring task ' || t || ' (' || days || ') to ' || private.person_name(new.assigned_to));
  end if;
  return new;
end $$;

drop trigger if exists recurring_after_write on public.recurring_tasks;
create trigger recurring_after_write after insert or update on public.recurring_tasks
  for each row execute function private.recurring_after_write();

-- Occurrences are routine: not "New", and no per-day notification.
create or replace function private.tasks_occurrence_defaults() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.recurring_id is not null then
    new.task_type := 'recurring';
    new.seen_at := now();
  end if;
  return new;
end $$;

-- Runs after tasks_before_write (triggers fire in name order: "tasks_b..." < "tasks_o...").
drop trigger if exists tasks_occurrence_defaults on public.tasks;
create trigger tasks_occurrence_defaults before insert on public.tasks
  for each row execute function private.tasks_occurrence_defaults();

create or replace function private.tasks_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := coalesce((select auth.uid()), case when tg_op = 'INSERT' then new.created_by end);
  who text;
  t text := '"' || new.title || '"';
  admins uuid[] := private.active_admins();
  by_assignee boolean;
  changes text[] := '{}';
begin
  if actor is null then return new; end if;
  if tg_op = 'INSERT' and new.recurring_id is not null then return new; end if;   -- template already notified
  who := private.person_name(actor);

  if tg_op = 'INSERT' then
    perform private.notify(array[new.assigned_to], new.id, actor, 'assigned', who || ' has assigned ' || t || ' to you');
    perform private.notify(array(select unnest(admins) except select new.assigned_to), new.id, actor, 'assigned',
      who || ' has assigned ' || t || ' to ' || private.person_name(new.assigned_to));
    return new;
  end if;

  by_assignee := actor = old.assigned_to;

  if new.assigned_to is distinct from old.assigned_to then
    perform private.notify(array[new.assigned_to], new.id, actor, 'reassigned', who || ' has assigned ' || t || ' to you');
    perform private.notify(
      array(select unnest(admins || case when by_assignee then array[old.assigned_by] else '{}'::uuid[] end)
            except select new.assigned_to),
      new.id, actor, 'reassigned', who || ' has reassigned ' || t || ' to ' || private.person_name(new.assigned_to));
    return new;
  end if;

  if not by_assignee then return new; end if;

  if new.status is distinct from old.status then
    perform private.notify(admins || new.assigned_by, new.id, actor, 'status',
      who || ' changed the status of ' || t || ' to ' || private.status_label(new.status::text));
  end if;

  if new.title is distinct from old.title then changes := changes || 'title'::text; end if;
  if new.description is distinct from old.description then changes := changes || 'description'::text; end if;
  if new.due_date is distinct from old.due_date then changes := changes || 'due date'::text; end if;
  if new.priority is distinct from old.priority then changes := changes || 'priority'::text; end if;
  if array_length(changes, 1) > 0 then
    perform private.notify(admins || new.assigned_by, new.id, actor, 'updated',
      who || ' updated the ' || array_to_string(changes, ', ') || ' of ' || t);
  end if;
  return new;
end $$;

-- ---------- Template RLS ----------
alter table public.recurring_tasks enable row level security;
create policy "recurring read" on public.recurring_tasks for select to authenticated
  using ((select auth.uid()) in (created_by, assigned_to) or (select private.is_admin()));
create policy "recurring create" on public.recurring_tasks for insert to authenticated
  with check (created_by = (select auth.uid()) and (select private.current_role_name()) is not null);
create policy "recurring update" on public.recurring_tasks for update to authenticated
  using (created_by = (select auth.uid()) or (select private.is_admin()))
  with check (created_by = (select auth.uid()) or (select private.is_admin()));
create policy "recurring delete" on public.recurring_tasks for delete to authenticated
  using (created_by = (select auth.uid()) or (select private.is_admin()));
revoke all on public.recurring_tasks from anon;

-- ---------- Nightly generator (00:05 IST, plus a 06:05 IST safety run) ----------
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname in ('generate-recurring-tasks', 'generate-recurring-tasks-retry');
select cron.schedule('generate-recurring-tasks', '35 18 * * *', $$select private.generate_recurring()$$);
select cron.schedule('generate-recurring-tasks-retry', '35 0 * * *', $$select private.generate_recurring()$$);

-- ---------- Time blocks ----------
create table if not exists public.time_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  notes text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint time_blocks_valid_range check (ends_at > starts_at)
);
create index if not exists time_blocks_user_time_idx on public.time_blocks(user_id, starts_at);

alter table public.time_blocks enable row level security;
create policy "blocks read own or admin" on public.time_blocks for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));
create policy "blocks create own" on public.time_blocks for insert to authenticated
  with check (user_id = (select auth.uid()) and (task_id is null or (select private.can_see_task(task_id))));
create policy "blocks update own" on public.time_blocks for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (task_id is null or (select private.can_see_task(task_id))));
create policy "blocks delete own" on public.time_blocks for delete to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.time_blocks from anon;

-- ===== supabase/migrations/20260925180000_task_time_drop_blocks.sql =====
-- =====================================================================
-- Time on the task itself (replaces separate calendar time blocks)
--   tasks.start_time / end_time : optional time of day on the task's due date
--   recurring_tasks.start_time / end_time : default time for each day's copy
-- The assignee (or creator/admin) can set a task's time.
-- =====================================================================

alter table public.tasks add column if not exists start_time time;
alter table public.tasks add column if not exists end_time time;
alter table public.tasks drop constraint if exists tasks_time_range;
alter table public.tasks add constraint tasks_time_range check (
  (start_time is null and end_time is null) or (start_time is not null and end_time is not null and end_time > start_time));

alter table public.recurring_tasks add column if not exists start_time time;
alter table public.recurring_tasks add column if not exists end_time time;
alter table public.recurring_tasks drop constraint if exists recurring_time_range;
alter table public.recurring_tasks add constraint recurring_time_range check (
  (start_time is null and end_time is null) or (start_time is not null and end_time is not null and end_time > start_time));

-- Keep the one test block's time by copying it onto its task.
update public.tasks t set
  start_time = (b.starts_at at time zone 'Asia/Kolkata')::time,
  end_time   = (b.ends_at   at time zone 'Asia/Kolkata')::time
from public.time_blocks b
where b.task_id = t.id and t.start_time is null
  and (b.ends_at at time zone 'Asia/Kolkata')::time > (b.starts_at at time zone 'Asia/Kolkata')::time;

create or replace function private.tasks_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  admin boolean := private.is_admin();
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(actor, new.assigned_by);
    new.assigned_by := new.created_by;
    new.assigned_at := now();
    new.reassigned := false;
    -- A task you give yourself isn't "new" to you.
    new.seen_at := case when new.assigned_to = new.created_by then now() else null end;
  else
    new.created_by := old.created_by;

    if actor is not null and not admin then
      if actor <> old.created_by and (
           new.title is distinct from old.title
        or new.description is distinct from old.description
        or new.due_date is distinct from old.due_date
        or new.priority is distinct from old.priority) then
        raise exception 'Only the person who created this task (or an admin) can change its details';
      end if;
      if new.assigned_to is distinct from old.assigned_to
         and actor not in (old.created_by, old.assigned_to, old.assigned_by) then
        raise exception 'Only the current assignee, the person who assigned it, or the creator can reassign this task';
      end if;
      -- Time of day: the assignee plans it; the creator can set it too.
      if (new.start_time is distinct from old.start_time or new.end_time is distinct from old.end_time)
         and actor not in (old.assigned_to, old.created_by) then
        raise exception 'Only the assignee or the creator can change the time of this task';
      end if;
      -- Only the current assignee can mark it as seen.
      if new.seen_at is distinct from old.seen_at and new.assigned_to is not distinct from old.assigned_to
         and actor <> old.assigned_to then
        new.seen_at := old.seen_at;
      end if;
    end if;

    if new.assigned_to is distinct from old.assigned_to then
      new.assigned_by := coalesce(actor, old.assigned_by);
      new.assigned_at := now();
      new.reassigned := true;
      new.seen_at := case when new.assigned_to = actor then now() else null end;
      if new.status = 'done' then new.status := 'todo'; end if;
    else
      new.assigned_by := old.assigned_by;
      new.assigned_at := old.assigned_at;
      new.reassigned := old.reassigned;
    end if;

    -- Any action by the assignee (e.g. changing status from the list) means they've seen it.
    if new.seen_at is null and actor is not null and actor = new.assigned_to
       and new.assigned_to is not distinct from old.assigned_to then
      new.seen_at := now();
    end if;

    -- Opening a task (seen_at only) shouldn't count as an edit.
    if row(new.title, new.description, new.due_date, new.priority, new.status, new.assigned_to, new.start_time, new.end_time)
       is distinct from row(old.title, old.description, old.due_date, old.priority, old.status, old.assigned_to, old.start_time, old.end_time) then
      new.updated_at := now();
    else
      new.updated_at := old.updated_at;
    end if;
  end if;

  new.participants := array(
    select distinct u from unnest(coalesce(old.participants, '{}') || array[new.created_by, new.assigned_by, new.assigned_to]) u
    where u is not null
  );

  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;

  if (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not exists (select 1 from public.profiles where id = new.assigned_to and is_active) then
    raise exception 'Tasks can only be assigned to active users';
  end if;
  return new;
end $$;

create or replace function private.tasks_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := coalesce((select auth.uid()), case when tg_op = 'INSERT' then new.created_by end);
  who text;
  t text := '"' || new.title || '"';
  admins uuid[] := private.active_admins();
  by_assignee boolean;
  changes text[] := '{}';
begin
  if actor is null then return new; end if;
  if tg_op = 'INSERT' and new.recurring_id is not null then return new; end if;   -- template already notified
  who := private.person_name(actor);

  if tg_op = 'INSERT' then
    perform private.notify(array[new.assigned_to], new.id, actor, 'assigned', who || ' has assigned ' || t || ' to you');
    perform private.notify(array(select unnest(admins) except select new.assigned_to), new.id, actor, 'assigned',
      who || ' has assigned ' || t || ' to ' || private.person_name(new.assigned_to));
    return new;
  end if;

  by_assignee := actor = old.assigned_to;

  if new.assigned_to is distinct from old.assigned_to then
    perform private.notify(array[new.assigned_to], new.id, actor, 'reassigned', who || ' has assigned ' || t || ' to you');
    perform private.notify(
      array(select unnest(admins || case when by_assignee then array[old.assigned_by] else '{}'::uuid[] end)
            except select new.assigned_to),
      new.id, actor, 'reassigned', who || ' has reassigned ' || t || ' to ' || private.person_name(new.assigned_to));
    return new;
  end if;

  if not by_assignee then return new; end if;

  if new.status is distinct from old.status then
    perform private.notify(admins || new.assigned_by, new.id, actor, 'status',
      who || ' changed the status of ' || t || ' to ' || private.status_label(new.status::text));
  end if;

  if new.title is distinct from old.title then changes := changes || 'title'::text; end if;
  if new.description is distinct from old.description then changes := changes || 'description'::text; end if;
  if new.due_date is distinct from old.due_date then changes := changes || 'due date'::text; end if;
  if new.priority is distinct from old.priority then changes := changes || 'priority'::text; end if;
  if new.start_time is distinct from old.start_time or new.end_time is distinct from old.end_time then
    changes := changes || 'time'::text;
  end if;
  if array_length(changes, 1) > 0 then
    perform private.notify(admins || new.assigned_by, new.id, actor, 'updated',
      who || ' updated the ' || array_to_string(changes, ', ') || ' of ' || t);
  end if;
  return new;
end $$;

create or replace function private.generate_recurring(p_date date default null, p_template uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare d date := coalesce(p_date, private.today_ist()); n integer;
begin
  insert into public.tasks (title, description, priority, assigned_by, assigned_to, due_date,
                            task_type, recurring_id, occurrence_date, start_time, end_time)
  select r.title, r.description, r.priority, r.created_by, r.assigned_to, d,
         'recurring', r.id, d, r.start_time, r.end_time
  from public.recurring_tasks r
  join public.profiles p on p.id = r.assigned_to and p.is_active
  where r.is_active
    and (p_template is null or r.id = p_template)
    and d >= r.start_date and (r.end_date is null or d <= r.end_date)
    and extract(dow from d)::smallint = any(r.weekdays)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

drop table if exists public.time_blocks;

-- ===== supabase/migrations/20260925190000_remove_blocked_status.sql =====
-- =====================================================================
-- Remove the "Blocked" status. Statuses are now: To Do, In Progress, Done.
-- Tasks that were Blocked move to In Progress.
-- =====================================================================

update public.tasks set status = 'in_progress' where status = 'blocked';

create type public.task_status_new as enum ('todo', 'in_progress', 'done');
alter table public.tasks alter column status drop default;
alter table public.tasks alter column status type public.task_status_new using status::text::public.task_status_new;
alter table public.tasks alter column status set default 'todo';
drop type public.task_status;
alter type public.task_status_new rename to task_status;

create or replace function private.status_label(s text) returns text
language sql immutable set search_path = '' as $$
  select case s when 'todo' then 'To Do' when 'in_progress' then 'In Progress'
                when 'done' then 'Done' when 'blocked' then 'Blocked' else s end
$$;

-- ===== supabase/migrations/20260925200000_log_deletions.sql =====
-- =====================================================================
-- Log deleted comments and attachments in the task's Activity.
-- (Skipped when the whole task is being deleted.)
-- =====================================================================

create or replace function private.child_log_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.tasks where id = old.task_id) then
    return old;                                   -- task itself is being deleted
  end if;
  if tg_table_name = 'task_comments' then
    insert into public.task_activity (task_id, actor_id, action, old_value)
    values (old.task_id, coalesce((select auth.uid()), old.author_id), 'comment_deleted', left(old.body, 120));
  else
    insert into public.task_activity (task_id, actor_id, action, old_value)
    values (old.task_id, coalesce((select auth.uid()), old.uploaded_by), 'attachment_deleted', old.file_name);
  end if;
  return old;
end $$;

drop trigger if exists task_comments_log_delete on public.task_comments;
create trigger task_comments_log_delete after delete on public.task_comments
  for each row execute function private.child_log_delete();
drop trigger if exists task_attachments_log_delete on public.task_attachments;
create trigger task_attachments_log_delete after delete on public.task_attachments
  for each row execute function private.child_log_delete();

-- ===== supabase/migrations/20260925210000_assignee_can_change_date.sql =====
-- =====================================================================
-- The assignee can now change the due date as well as the time
-- (edited inline on the task's Details tab). Creator and admins still can.
-- =====================================================================

create or replace function private.tasks_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  admin boolean := private.is_admin();
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(actor, new.assigned_by);
    new.assigned_by := new.created_by;
    new.assigned_at := now();
    new.reassigned := false;
    -- A task you give yourself isn't "new" to you.
    new.seen_at := case when new.assigned_to = new.created_by then now() else null end;
  else
    new.created_by := old.created_by;

    if actor is not null and not admin then
      if actor <> old.created_by and (
           new.title is distinct from old.title
        or new.description is distinct from old.description
        or new.priority is distinct from old.priority) then
        raise exception 'Only the person who created this task (or an admin) can change its details';
      end if;
      if new.assigned_to is distinct from old.assigned_to
         and actor not in (old.created_by, old.assigned_to, old.assigned_by) then
        raise exception 'Only the current assignee, the person who assigned it, or the creator can reassign this task';
      end if;
      -- Date & time: the assignee plans them; the creator can set them too.
      if (new.due_date is distinct from old.due_date
          or new.start_time is distinct from old.start_time or new.end_time is distinct from old.end_time)
         and actor not in (old.assigned_to, old.created_by) then
        raise exception 'Only the assignee or the creator can change the date or time of this task';
      end if;
      -- Only the current assignee can mark it as seen.
      if new.seen_at is distinct from old.seen_at and new.assigned_to is not distinct from old.assigned_to
         and actor <> old.assigned_to then
        new.seen_at := old.seen_at;
      end if;
    end if;

    if new.assigned_to is distinct from old.assigned_to then
      new.assigned_by := coalesce(actor, old.assigned_by);
      new.assigned_at := now();
      new.reassigned := true;
      new.seen_at := case when new.assigned_to = actor then now() else null end;
      if new.status = 'done' then new.status := 'todo'; end if;
    else
      new.assigned_by := old.assigned_by;
      new.assigned_at := old.assigned_at;
      new.reassigned := old.reassigned;
    end if;

    -- Any action by the assignee (e.g. changing status from the list) means they've seen it.
    if new.seen_at is null and actor is not null and actor = new.assigned_to
       and new.assigned_to is not distinct from old.assigned_to then
      new.seen_at := now();
    end if;

    -- Opening a task (seen_at only) shouldn't count as an edit.
    if row(new.title, new.description, new.due_date, new.priority, new.status, new.assigned_to, new.start_time, new.end_time)
       is distinct from row(old.title, old.description, old.due_date, old.priority, old.status, old.assigned_to, old.start_time, old.end_time) then
      new.updated_at := now();
    else
      new.updated_at := old.updated_at;
    end if;
  end if;

  new.participants := array(
    select distinct u from unnest(coalesce(old.participants, '{}') || array[new.created_by, new.assigned_by, new.assigned_to]) u
    where u is not null
  );

  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;

  if (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not exists (select 1 from public.profiles where id = new.assigned_to and is_active) then
    raise exception 'Tasks can only be assigned to active users';
  end if;
  return new;
end $$;

-- ===== supabase/migrations/20260925220000_plan_recurring_day.sql =====
-- =====================================================================
-- Move ONE future day of a recurring task ("only this date").
-- Creates that day's copy now (normally created at midnight) and sets its
-- time. Callable by the assignee, the creator or an admin.
-- =====================================================================

create or replace function public.plan_recurring_day(
  p_template uuid, p_date date, p_start time, p_end time, p_new_date date default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  r public.recurring_tasks;
  me uuid := (select auth.uid());
  tid uuid;
begin
  select * into r from public.recurring_tasks where id = p_template;
  if not found then raise exception 'Recurring task not found'; end if;
  if me is null or not (me in (r.assigned_to, r.created_by) or private.is_admin()) then
    raise exception 'You cannot change this recurring task';
  end if;
  if p_date < private.today_ist() then raise exception 'That day has already passed'; end if;
  if (p_start is null) <> (p_end is null) or (p_start is not null and p_end <= p_start) then
    raise exception 'End time must be after start time';
  end if;

  perform private.generate_recurring(p_date, p_template);
  select id into tid from public.tasks where recurring_id = p_template and occurrence_date = p_date;
  if tid is null then raise exception 'This day is not part of the schedule'; end if;

  update public.tasks
     set start_time = p_start, end_time = p_end, due_date = coalesce(p_new_date, due_date)
   where id = tid;
  return tid;
end $$;

revoke execute on function public.plan_recurring_day(uuid, date, time, time, date) from public, anon;
grant execute on function public.plan_recurring_day(uuid, date, time, time, date) to authenticated;

-- ===== supabase/migrations/20260925230000_roles_master.sql =====
-- =====================================================================
-- Roles become a master list (Users & Roles → Roles tab).
-- * public.roles: name + description. The built-in "Admin" role is the only
--   one with admin access; every other role is a label (like Manager).
-- * profiles.role_id points at a role. The old profiles.role enum is kept in
--   sync automatically ('admin' for the Admin role, 'team_member' otherwise),
--   so every permission check (private.is_admin etc.) keeps working.
-- * Built-in roles (Admin, Team Member) can't be deleted; Admin can't be renamed.
--   A role that people still have can't be deleted.
-- =====================================================================

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_admin boolean not null default false,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index roles_name_key on public.roles (lower(name));

insert into public.roles (name, description, is_admin, is_system) values
  ('Admin', 'Full access: manages users, roles, teams and sees every task.', true, true),
  ('Manager', 'Label only – same access as a team member.', false, false),
  ('Team Member', 'Default role for new users.', false, true);

alter table public.roles enable row level security;
create policy "roles read" on public.roles for select to authenticated using (true);
create policy "roles admin insert" on public.roles for insert to authenticated with check ((select private.is_admin()));
create policy "roles admin update" on public.roles for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "roles admin delete" on public.roles for delete to authenticated using ((select private.is_admin()));
revoke all on public.roles from anon;
grant select, insert, update, delete on public.roles to authenticated;

-- Guard the built-in roles and the admin flag.
create or replace function private.roles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then raise exception 'Built-in role "%" cannot be deleted', old.name; end if;
    if exists (select 1 from public.profiles where role_id = old.id) then
      raise exception 'Role "%" is still given to % user(s). Move them to another role first.',
        old.name, (select count(*) from public.profiles where role_id = old.id);
    end if;
    return old;
  end if;

  new.name := btrim(new.name);
  if new.name = '' then raise exception 'Role name is required'; end if;
  if tg_op = 'INSERT' then
    new.is_admin := false;           -- only the built-in Admin role has admin access
    new.is_system := false;
  else
    new.is_admin := old.is_admin;
    new.is_system := old.is_system;
    new.created_at := old.created_at;
    if old.is_admin and new.name <> old.name then raise exception 'The Admin role cannot be renamed'; end if;
    new.updated_at := now();
  end if;
  return new;
end $$;

create trigger roles_guard before insert or update or delete on public.roles
  for each row execute function private.roles_guard();

-- profiles.role_id
alter table public.profiles add column role_id uuid references public.roles(id);
update public.profiles p set role_id = r.id from public.roles r
 where r.name = case p.role when 'admin' then 'Admin' when 'manager' then 'Manager' else 'Team Member' end;
alter table public.profiles alter column role_id set not null;
create index profiles_role_id_idx on public.profiles (role_id);

-- Keep role_id and the legacy enum in sync. Callers may send either
-- (role_id preferred; a bare enum 'role' still works for older code).
create or replace function private.profiles_role_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  admin_role boolean;
begin
  if new.role_id is null
     or (tg_op = 'UPDATE' and new.role_id is not distinct from old.role_id and new.role is distinct from old.role) then
    select id into new.role_id from public.roles
     where name = case new.role when 'admin' then 'Admin' when 'manager' then 'Manager' else 'Team Member' end;
    if new.role_id is null then
      select id into new.role_id from public.roles where is_system and not is_admin order by created_at limit 1;
    end if;
  end if;
  select is_admin into admin_role from public.roles where id = new.role_id;
  if admin_role is null then raise exception 'Unknown role'; end if;
  new.role := case when admin_role then 'admin' else 'team_member' end::public.user_role;
  return new;
end $$;

create trigger profiles_role_sync before insert or update on public.profiles
  for each row execute function private.profiles_role_sync();

-- Re-derive the legacy enum for existing users (Manager → 'team_member').
update public.profiles set role_id = role_id;

-- ===== supabase/migrations/20260926100000_reports.sql =====
-- =====================================================================
-- v1.1 Reports: per-person numbers for a date range (admin only).
-- A task belongs to the range by its due date. Its deadline is the end
-- time on the due date, or the end of that day when it has no time (IST).
--   on_time  = done at or before the deadline
--   late     = done after the deadline
--   expired  = not done and the deadline has passed
--   pending  = not done and the deadline is still ahead
-- =====================================================================

create or replace function private.task_deadline(p_due date, p_end time)
returns timestamptz language sql immutable set search_path = '' as $$
  select case when p_due is null then null
    else ((p_due + coalesce(p_end, time '23:59:59')) at time zone 'Asia/Kolkata') end
$$;

create or replace function public.report_by_person(p_from date, p_to date, p_team uuid default null)
returns table (
  user_id uuid, full_name text, team_name text, role_name text,
  assigned int, completed int, on_time int, late int, expired int, pending int
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Only admins can see reports'; end if;
  return query
  with t as (
    select x.assigned_to, x.status, x.completed_at, private.task_deadline(x.due_date, x.end_time) as deadline
    from public.tasks x
    where x.due_date between p_from and p_to
  )
  select p.id, p.full_name, tm.name, r.name,
    count(t.*)::int,
    count(*) filter (where t.status = 'done')::int,
    count(*) filter (where t.status = 'done' and t.completed_at <= t.deadline)::int,
    count(*) filter (where t.status = 'done' and t.completed_at > t.deadline)::int,
    count(*) filter (where t.status <> 'done' and t.deadline < now())::int,
    count(*) filter (where t.status <> 'done' and t.deadline >= now())::int
  from public.profiles p
  left join public.teams tm on tm.id = p.team_id
  left join public.roles r on r.id = p.role_id
  left join t on t.assigned_to = p.id
  where (p.is_active or t.assigned_to is not null)
    and (p_team is null or p.team_id = p_team)
  group by p.id, p.full_name, tm.name, r.name
  order by p.full_name;
end $$;

revoke execute on function public.report_by_person(date, date, uuid) from public, anon;
grant execute on function public.report_by_person(date, date, uuid) to authenticated;

-- ===== supabase/migrations/20260926110000_whatsapp_outbox.sql =====
-- =====================================================================
-- v1.1 WhatsApp (WATI) notifications.
-- Database triggers put messages in public.whatsapp_outbox; the Edge
-- Function `whatsapp-sender` sends them through WATI (run every minute by
-- pg_cron while something is waiting). Nothing is sent until the WATI
-- secrets are set on the function. Messages older than 24 h are dropped.
--
--   task_assigned      -> assignee, when a task (or recurring task) is assigned / reassigned to them
--   task_comment       -> assigner, when the assignee comments (comments within 2 min are combined)
--   daily_task_report  -> every active admin, at 20:00 IST
-- Nobody is messaged about their own action; daily copies of recurring
-- tasks don't send anything.
-- =====================================================================

create extension if not exists pg_net with schema extensions;

create table public.whatsapp_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('task_assigned', 'task_comment', 'daily_task_report')),
  recipient_id uuid references public.profiles(id) on delete cascade,
  phone text,
  template text not null,
  params jsonb not null default '{}'::jsonb,       -- {variable: value}, in template order
  task_id uuid references public.tasks(id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped', 'expired')),
  attempts int not null default 0,
  last_error text,
  send_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index whatsapp_outbox_queue_idx on public.whatsapp_outbox (status, send_after);
create index whatsapp_outbox_created_idx on public.whatsapp_outbox (created_at desc);

alter table public.whatsapp_outbox enable row level security;
create policy "whatsapp log admin read" on public.whatsapp_outbox for select to authenticated using ((select private.is_admin()));
revoke all on public.whatsapp_outbox from anon;
revoke insert, update, delete on public.whatsapp_outbox from authenticated;
grant select on public.whatsapp_outbox to authenticated;

-- Settings the database needs (not secret): the app link used in messages.
create table private.app_settings (key text primary key, value text not null);
insert into private.app_settings values ('app_url', 'https://pride.viralsakhiya.com');

create or replace function private.setting(p_key text) returns text
language sql stable security definer set search_path = '' as $$
  select value from private.app_settings where key = p_key
$$;

-- "98673 33582" / "+91 9867333582" / "09867333582" -> "919867333582"; null if unusable.
create or replace function private.wa_phone(p_phone text) returns text
language plpgsql immutable set search_path = '' as $$
declare d text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if length(d) = 11 and left(d, 1) = '0' then d := substr(d, 2); end if;
  if length(d) = 10 then d := '91' || d; end if;
  if length(d) < 11 or length(d) > 15 then return null; end if;
  return d;
end $$;

-- WhatsApp template parameters can't contain new lines or long runs of spaces.
create or replace function private.wa_text(p text, p_max int default 200) returns text
language sql immutable set search_path = '' as $$
  select left(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')), p_max)
$$;

create or replace function private.wa_enqueue(p_kind text, p_recipient uuid, p_params jsonb, p_task uuid default null, p_delay interval default '0')
returns void language plpgsql security definer set search_path = '' as $$
declare
  ph text;
  tmpl text := p_kind;   -- template name in WATI = kind (see whatsapp-sender to override)
begin
  select private.wa_phone(phone) into ph from public.profiles where id = p_recipient and is_active;
  if not found then return; end if;
  insert into public.whatsapp_outbox (kind, recipient_id, phone, template, params, task_id, send_after, status, last_error)
  values (p_kind, p_recipient, ph, tmpl, p_params, p_task, now() + p_delay,
          case when ph is null then 'skipped' else 'queued' end,
          case when ph is null then 'No valid phone number on the profile' end);
end $$;

create or replace function private.wa_due_text(p_due date, p_start time, p_end time) returns text
language sql immutable set search_path = '' as $$
  select case when p_due is null then 'no due date'
    else to_char(p_due, 'DD-Mon-YYYY')
      || case when p_start is not null then ', ' || to_char(p_start, 'HH12:MI AM')
           || case when p_end is not null then ' - ' || to_char(p_end, 'HH12:MI AM') else '' end
         else '' end
  end
$$;

-- ---------------------------------------------------------------------
-- Task assigned / reassigned (one-off tasks and recurring schedules;
-- the daily copies of a recurring task are skipped).
-- ---------------------------------------------------------------------
create or replace function private.wa_task_assigned() returns trigger
language plpgsql security definer set search_path = '' as $$
declare actor uuid := coalesce((select auth.uid()), new.assigned_by);
begin
  if new.recurring_id is not null then return new; end if;
  if tg_op = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to then return new; end if;
  if new.assigned_to = actor then return new; end if;
  perform private.wa_enqueue('task_assigned', new.assigned_to, jsonb_build_object(
    'name', private.wa_text(private.person_name(new.assigned_to), 60),
    'assigner', private.wa_text(private.person_name(actor), 60),
    'task_no', 'TM-' || new.task_no,
    'title', private.wa_text(new.title, 120),
    'due', private.wa_due_text(new.due_date, new.start_time, new.end_time),
    'link', private.setting('app_url') || '/tasks?task=' || new.id
  ), new.id);
  return new;
end $$;

create trigger tasks_whatsapp after insert or update of assigned_to on public.tasks
  for each row execute function private.wa_task_assigned();

create or replace function private.wa_recurring_assigned() returns trigger
language plpgsql security definer set search_path = '' as $$
declare actor uuid := coalesce((select auth.uid()), new.created_by);
begin
  if tg_op = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to then return new; end if;
  if new.assigned_to = actor then return new; end if;
  perform private.wa_enqueue('task_assigned', new.assigned_to, jsonb_build_object(
    'name', private.wa_text(private.person_name(new.assigned_to), 60),
    'assigner', private.wa_text(private.person_name(actor), 60),
    'task_no', 'Recurring',
    'title', private.wa_text(new.title, 120),
    'due', 'every ' || private.weekday_names(new.weekdays) || ' from ' || to_char(new.start_date, 'DD-Mon-YYYY'),
    'link', private.setting('app_url') || '/tasks?view=recurring'
  ));
  return new;
end $$;

create trigger recurring_whatsapp after insert or update of assigned_to on public.recurring_tasks
  for each row execute function private.wa_recurring_assigned();

-- ---------------------------------------------------------------------
-- Assignee comments -> assigner. Comments within 2 minutes are combined
-- into one message (the latest text + "and N more").
-- ---------------------------------------------------------------------
create or replace function private.wa_task_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t public.tasks;
  pending public.whatsapp_outbox;
  more int;
begin
  select * into t from public.tasks where id = new.task_id;
  if not found or new.author_id <> t.assigned_to or t.assigned_by is null or t.assigned_by = new.author_id then
    return new;
  end if;

  select * into pending from public.whatsapp_outbox
   where kind = 'task_comment' and task_id = t.id and recipient_id = t.assigned_by and status = 'queued'
   order by created_at desc limit 1 for update;

  if found then
    more := coalesce((pending.params->>'more_count')::int, 0) + 1;
    update public.whatsapp_outbox set
      params = pending.params || jsonb_build_object(
        'comment', private.wa_text(new.body, 150) || ' (+' || more || ' more)',
        'more_count', more),
      send_after = now() + interval '2 minutes'
    where id = pending.id;
  else
    perform private.wa_enqueue('task_comment', t.assigned_by, jsonb_build_object(
      'name', private.wa_text(private.person_name(t.assigned_by), 60),
      'commenter', private.wa_text(private.person_name(new.author_id), 60),
      'task_no', 'TM-' || t.task_no,
      'title', private.wa_text(t.title, 120),
      'comment', private.wa_text(new.body, 150),
      'link', private.setting('app_url') || '/tasks?task=' || t.id
    ), t.id, interval '2 minutes');
  end if;
  return new;
end $$;

create trigger task_comments_whatsapp after insert on public.task_comments
  for each row execute function private.wa_task_comment();

-- ---------------------------------------------------------------------
-- Day-end report to admins (20:00 IST). Counts tasks due today.
-- ---------------------------------------------------------------------
create or replace function private.wa_daily_report(p_day date default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  d date := coalesce(p_day, private.today_ist());
  total int; done int; expired int; pending int; overdue_open int; n int := 0;
  a uuid;
begin
  select count(*),
         count(*) filter (where status = 'done'),
         count(*) filter (where status <> 'done' and private.task_deadline(due_date, end_time) < now()),
         count(*) filter (where status <> 'done' and private.task_deadline(due_date, end_time) >= now())
    into total, done, expired, pending
    from public.tasks where due_date = d;
  select count(*) into overdue_open from public.tasks where status <> 'done' and due_date < d;

  foreach a in array private.active_admins() loop
    perform private.wa_enqueue('daily_task_report', a, jsonb_build_object(
      'name', private.wa_text(private.person_name(a), 60),
      'date', to_char(d, 'DD-Mon-YYYY'),
      'total', total::text, 'done', done::text, 'expired', expired::text, 'pending', pending::text,
      'overdue', overdue_open::text,
      'link', private.setting('app_url') || '/reports'
    ));
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Sender side: the Edge Function claims a batch (service role only).
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_claim_batch(p_limit int default 20)
returns setof public.whatsapp_outbox
language plpgsql security definer set search_path = '' as $$
begin
  -- Old messages are no longer useful (e.g. queued before WATI was set up).
  update public.whatsapp_outbox set status = 'expired', last_error = 'Not sent within 24 hours'
   where status in ('queued', 'sending') and created_at < now() - interval '24 hours';
  -- A batch stuck in "sending" (function crashed) goes back to the queue.
  update public.whatsapp_outbox set status = 'queued'
   where status = 'sending' and send_after < now() - interval '10 minutes';

  return query
  update public.whatsapp_outbox o set status = 'sending', attempts = o.attempts + 1, send_after = now()
   where o.id in (
     select id from public.whatsapp_outbox
      where status = 'queued' and send_after <= now()
      order by send_after limit p_limit
      for update skip locked)
  returning o.*;
end $$;

create or replace function public.whatsapp_mark(p_id uuid, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.whatsapp_outbox set
    status = case when p_ok then 'sent' when attempts >= 5 then 'failed' else 'queued' end,
    sent_at = case when p_ok then now() end,
    last_error = case when p_ok then null else left(p_error, 500) end,
    -- retry after 1, 2, 4, 8 minutes
    send_after = case when p_ok then send_after else now() + (interval '1 minute' * power(2, greatest(attempts - 1, 0))) end
  where id = p_id;
end $$;

revoke execute on function public.whatsapp_claim_batch(int) from public, anon, authenticated;
revoke execute on function public.whatsapp_mark(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.whatsapp_claim_batch(int) to service_role;
grant execute on function public.whatsapp_mark(uuid, boolean, text) to service_role;

-- ---------------------------------------------------------------------
-- Schedules (UTC): sender every minute (only calls the function when
-- something is due); day-end report at 14:30 UTC = 20:00 IST.
-- ---------------------------------------------------------------------
create or replace function private.wa_kick() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.whatsapp_outbox where status = 'queued' and send_after <= now()) then
    perform net.http_post(
      url := 'https://tazlvzjalhxsudceabqy.supabase.co/functions/v1/whatsapp-sender',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 30000);
  end if;
end $$;

select cron.schedule('whatsapp-sender', '* * * * *', $$select private.wa_kick()$$);
select cron.schedule('whatsapp-daily-report', '30 14 * * *', $$select private.wa_daily_report()$$);

-- ===== supabase/migrations/20260926120000_app_url_sync.sql =====
-- =====================================================================
-- The app's web address (used in WhatsApp links) is a setting, not code:
-- private.app_settings.app_url. When an admin opens the app from its real
-- address, the app keeps this setting in sync, so moving to a new domain
-- needs no code change. Local addresses (localhost etc.) are ignored.
-- =====================================================================

create or replace function public.sync_app_url(p_url text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  u text := rtrim(btrim(coalesce(p_url, '')), '/');
begin
  if not private.is_admin() then return private.setting('app_url'); end if;
  if u !~ '^https://[a-z0-9.-]+\.[a-z]{2,}(:[0-9]+)?$' or u ~ '(localhost|127\.0\.0\.1|\.local$|\.test$)' then
    return private.setting('app_url');
  end if;
  insert into private.app_settings (key, value) values ('app_url', u)
    on conflict (key) do update set value = excluded.value
    where private.app_settings.value is distinct from excluded.value;
  return u;
end $$;

revoke execute on function public.sync_app_url(text) from public, anon;
grant execute on function public.sync_app_url(text) to authenticated;

-- ===== supabase/migrations/20260926130000_whatsapp_fewer_variables.sql =====
-- =====================================================================
-- WhatsApp templates: fewer variables (Meta rejects templates with too
-- many variables for their length). Task number and title are now one
-- variable: {{task}} = "TM-125 – Prepare TVS weekly report".
-- =====================================================================

create or replace function private.wa_task_assigned() returns trigger
language plpgsql security definer set search_path = '' as $$
declare actor uuid := coalesce((select auth.uid()), new.assigned_by);
begin
  if new.recurring_id is not null then return new; end if;
  if tg_op = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to then return new; end if;
  if new.assigned_to = actor then return new; end if;
  perform private.wa_enqueue('task_assigned', new.assigned_to, jsonb_build_object(
    'name', private.wa_text(private.person_name(new.assigned_to), 60),
    'assigner', private.wa_text(private.person_name(actor), 60),
    'task', 'TM-' || new.task_no || ' – ' || private.wa_text(new.title, 120),
    'due', private.wa_due_text(new.due_date, new.start_time, new.end_time),
    'link', private.setting('app_url') || '/tasks?task=' || new.id
  ), new.id);
  return new;
end $$;

create or replace function private.wa_recurring_assigned() returns trigger
language plpgsql security definer set search_path = '' as $$
declare actor uuid := coalesce((select auth.uid()), new.created_by);
begin
  if tg_op = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to then return new; end if;
  if new.assigned_to = actor then return new; end if;
  perform private.wa_enqueue('task_assigned', new.assigned_to, jsonb_build_object(
    'name', private.wa_text(private.person_name(new.assigned_to), 60),
    'assigner', private.wa_text(private.person_name(actor), 60),
    'task', 'Recurring – ' || private.wa_text(new.title, 120),
    'due', 'every ' || private.weekday_names(new.weekdays) || ' from ' || to_char(new.start_date, 'DD-Mon-YYYY'),
    'link', private.setting('app_url') || '/tasks?view=recurring'
  ));
  return new;
end $$;

create or replace function private.wa_task_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t public.tasks;
  pending public.whatsapp_outbox;
  more int;
begin
  select * into t from public.tasks where id = new.task_id;
  if not found or new.author_id <> t.assigned_to or t.assigned_by is null or t.assigned_by = new.author_id then
    return new;
  end if;

  select * into pending from public.whatsapp_outbox
   where kind = 'task_comment' and task_id = t.id and recipient_id = t.assigned_by and status = 'queued'
   order by created_at desc limit 1 for update;

  if found then
    more := coalesce((pending.params->>'more_count')::int, 0) + 1;
    update public.whatsapp_outbox set
      params = pending.params || jsonb_build_object(
        'comment', private.wa_text(new.body, 150) || ' (+' || more || ' more)',
        'more_count', more),
      send_after = now() + interval '2 minutes'
    where id = pending.id;
  else
    perform private.wa_enqueue('task_comment', t.assigned_by, jsonb_build_object(
      'name', private.wa_text(private.person_name(t.assigned_by), 60),
      'commenter', private.wa_text(private.person_name(new.author_id), 60),
      'task', 'TM-' || t.task_no || ' – ' || private.wa_text(t.title, 120),
      'comment', private.wa_text(new.body, 150),
      'link', private.setting('app_url') || '/tasks?task=' || t.id
    ), t.id, interval '2 minutes');
  end if;
  return new;
end $$;

-- ===== supabase/migrations/20260926140000_whatsapp_retry.sql =====
-- =====================================================================
-- WhatsApp Logs page: admins can send a failed / expired / skipped message
-- again. It goes back into the queue as a fresh message (the phone number
-- is read again from the profile, in case it was just added or fixed).
-- =====================================================================

create or replace function public.whatsapp_retry(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  o public.whatsapp_outbox;
  ph text;
begin
  if not private.is_admin() then raise exception 'Only admins can resend WhatsApp messages'; end if;
  select * into o from public.whatsapp_outbox where id = p_id for update;
  if not found then raise exception 'Message not found'; end if;
  if o.status not in ('failed', 'expired', 'skipped') then
    raise exception 'Only failed, expired or skipped messages can be sent again';
  end if;
  select private.wa_phone(phone) into ph from public.profiles where id = o.recipient_id and is_active;
  if ph is null then raise exception 'This person has no valid WhatsApp number (or is inactive). Add it in Users & Roles first.'; end if;

  update public.whatsapp_outbox set
    phone = ph, status = 'queued', attempts = 0, last_error = null,
    created_at = now(), send_after = now(), sent_at = null
  where id = p_id;
  return 'queued';
end $$;

revoke execute on function public.whatsapp_retry(uuid) from public, anon;
grant execute on function public.whatsapp_retry(uuid) to authenticated;

-- ===== supabase/migrations/20260926150000_daily_report_2115.sql =====
-- Day-end WhatsApp report now at 21:15 IST (15:45 UTC), every day.
select cron.unschedule('whatsapp-daily-report');
select cron.schedule('whatsapp-daily-report', '45 15 * * *', $$select private.wa_daily_report()$$);

-- ===== supabase/migrations/20260926160000_whatsapp_instant.sql =====
-- Send WhatsApp messages right away instead of waiting for the next
-- once-a-minute run: when a message is queued (or put back by "Send again"),
-- call the sender immediately. The per-minute job stays as a safety net and
-- still sends delayed messages (comments wait 2 min so several are combined)
-- and retries.
create or replace function private.wa_kick_now() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.wa_kick();   -- only calls the function when something is due now
  return null;
end $$;

create trigger whatsapp_outbox_kick after insert or update of status on public.whatsapp_outbox
  for each row when (new.status = 'queued' and new.send_after <= now())
  execute function private.wa_kick_now();

-- ===== supabase/migrations/20260929100000_perisclaw.sql =====
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

-- ===== supabase/migrations/20260929110000_perisclaw_row_actions.sql =====
-- Perisclaw rows: admins can now add or skip ANY row that isn't a task yet,
-- including rows that were already in the sheet when it was connected.
create or replace function private.perisclaw_entries_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null then
    if new.status not in ('ignored', 'created')
       or old.status not in ('needs_review', 'error', 'ignored', 'skipped_existing') then
      raise exception 'Only rows that are not tasks yet can be added or skipped';
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

-- Existing rows are always skipped when a sheet is connected (admins add them by hand if needed).
update public.perisclaw_settings set import_existing = false;

-- ===== supabase/migrations/20260929120000_perisclaw_task_deleted.sql =====
-- Deleting a task that came from Perisclaw failed: the foreign key sets
-- perisclaw_entries.task_id to NULL, and the row guard refused that update.
-- Now, when a row's task is deleted, the row becomes "Skipped" (reason: task deleted).
-- It can still be added again from the Action column.
create or replace function private.perisclaw_entries_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- The linked task was deleted (ON DELETE SET NULL): free the row.
  if old.task_id is not null and new.task_id is null and old.status = 'created'
     and not exists (select 1 from public.tasks where id = old.task_id) then
    new.status := 'ignored';
    new.reason := 'Its task was deleted';
    new.processed_at := now();
    return new;
  end if;

  if (select auth.uid()) is not null then
    if new.status not in ('ignored', 'created')
       or old.status not in ('needs_review', 'error', 'ignored', 'skipped_existing') then
      raise exception 'Only rows that are not tasks yet can be added or skipped';
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

-- ===== supabase/migrations/20260930100000_perisclaw_retry.sql =====
-- Gemini sometimes answers "503 high demand" / "429 too many requests".
-- The sync now retries such rows by itself on the next runs (up to 5 tries per row).
alter table public.perisclaw_entries add column attempts int not null default 0;
update public.perisclaw_entries set attempts = 1 where status in ('created', 'needs_review', 'error');

create or replace function private.perisclaw_entries_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- The linked task was deleted (ON DELETE SET NULL): free the row.
  if old.task_id is not null and new.task_id is null and old.status = 'created'
     and not exists (select 1 from public.tasks where id = old.task_id) then
    new.status := 'ignored';
    new.reason := 'Its task was deleted';
    new.processed_at := now();
    return new;
  end if;

  if (select auth.uid()) is not null then
    if new.status not in ('ignored', 'created')
       or old.status not in ('needs_review', 'error', 'ignored', 'skipped_existing') then
      raise exception 'Only rows that are not tasks yet can be added or skipped';
    end if;
    new.row_hash := old.row_hash; new.raw := old.raw; new.raw_text := old.raw_text;
    new.row_number := old.row_number; new.parsed := old.parsed; new.created_at := old.created_at;
    new.attempts := old.attempts;
    new.reviewed_by := (select auth.uid());
    new.processed_at := now();
    if new.status = 'created' and (new.task_id is null or not exists (select 1 from public.tasks where id = new.task_id)) then
      raise exception 'Link the created task';
    end if;
  end if;
  return new;
end $$;

-- ===== supabase/migrations/20260930110000_unassigned_tasks.sql =====
-- =====================================================================
-- Unassigned tasks (for Perisclaw).
-- Perisclaw rows now always become tasks. If the person named in the row
-- isn't a user of the app, the task is created with no assignee, and every
-- active admin gets a WhatsApp message + a bell notification asking them to
-- create the user and assign the task.
-- Only the system (Perisclaw sync) or an admin can leave a task unassigned.
-- =====================================================================

alter table public.tasks alter column assigned_to drop not null;

-- New WhatsApp message kind for the admin alert.
alter table public.whatsapp_outbox drop constraint whatsapp_outbox_kind_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_kind_check
  check (kind in ('task_assigned', 'task_comment', 'daily_task_report', 'task_unassigned'));

-- ---------------------------------------------------------------------
-- Task rules: same as before, plus the "no assignee" case.
-- ---------------------------------------------------------------------
create or replace function private.tasks_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  admin boolean := private.is_admin();
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(actor, new.assigned_by);
    new.assigned_by := new.created_by;
    new.assigned_at := now();
    new.reassigned := false;
    new.seen_at := case when new.assigned_to = new.created_by then now() else null end;
  else
    new.created_by := old.created_by;

    if actor is not null and not admin then
      if actor <> old.created_by and (
           new.title is distinct from old.title
        or new.description is distinct from old.description
        or new.priority is distinct from old.priority) then
        raise exception 'Only the person who created this task (or an admin) can change its details';
      end if;
      if new.assigned_to is distinct from old.assigned_to
         and actor not in (old.created_by, coalesce(old.assigned_to, old.created_by), old.assigned_by) then
        raise exception 'Only the current assignee, the person who assigned it, or the creator can reassign this task';
      end if;
      if (new.due_date is distinct from old.due_date
          or new.start_time is distinct from old.start_time or new.end_time is distinct from old.end_time)
         and actor not in (coalesce(old.assigned_to, old.created_by), old.created_by) then
        raise exception 'Only the assignee or the creator can change the date or time of this task';
      end if;
      if new.seen_at is distinct from old.seen_at and new.assigned_to is not distinct from old.assigned_to
         and actor is distinct from old.assigned_to then
        new.seen_at := old.seen_at;
      end if;
    end if;

    if new.assigned_to is distinct from old.assigned_to then
      new.assigned_by := coalesce(actor, old.assigned_by);
      new.assigned_at := now();
      new.reassigned := old.assigned_to is not null;          -- first assignment of an unassigned task isn't a handover
      new.seen_at := case when new.assigned_to = actor then now() else null end;
      if new.status = 'done' then new.status := 'todo'; end if;
    else
      new.assigned_by := old.assigned_by;
      new.assigned_at := old.assigned_at;
      new.reassigned := old.reassigned;
    end if;

    if new.seen_at is null and actor is not null and actor = new.assigned_to
       and new.assigned_to is not distinct from old.assigned_to then
      new.seen_at := now();
    end if;

    if row(new.title, new.description, new.due_date, new.priority, new.status, new.assigned_to, new.start_time, new.end_time)
       is distinct from row(old.title, old.description, old.due_date, old.priority, old.status, old.assigned_to, old.start_time, old.end_time) then
      new.updated_at := now();
    else
      new.updated_at := old.updated_at;
    end if;
  end if;

  new.participants := array(
    select distinct u from unnest(coalesce(old.participants, '{}') || array[new.created_by, new.assigned_by, new.assigned_to]) u
    where u is not null
  );

  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;

  if tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to then
    if new.assigned_to is null then
      if actor is not null and not admin then
        raise exception 'Choose who to assign this task to';
      end if;
    elsif not exists (select 1 from public.profiles where id = new.assigned_to and is_active) then
      raise exception 'Tasks can only be assigned to active users';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Bell notifications: unassigned tasks go to the admins.
-- ---------------------------------------------------------------------
create or replace function private.tasks_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := coalesce((select auth.uid()), case when tg_op = 'INSERT' then new.created_by end);
  who text;
  t text := '"' || new.title || '"';
  admins uuid[] := private.active_admins();
  by_assignee boolean;
  changes text[] := '{}';
begin
  if actor is null then return new; end if;
  if tg_op = 'INSERT' and new.recurring_id is not null then return new; end if;
  who := private.person_name(actor);

  if tg_op = 'INSERT' then
    if new.assigned_to is null then
      perform private.notify(admins, new.id, actor, 'assigned', who || ' added ' || t || ' without an assignee');
      return new;
    end if;
    perform private.notify(array[new.assigned_to], new.id, actor, 'assigned', who || ' has assigned ' || t || ' to you');
    perform private.notify(array(select unnest(admins) except select new.assigned_to), new.id, actor, 'assigned',
      who || ' has assigned ' || t || ' to ' || private.person_name(new.assigned_to));
    return new;
  end if;

  by_assignee := coalesce(actor = old.assigned_to, false);

  if new.assigned_to is distinct from old.assigned_to then
    if new.assigned_to is null then return new; end if;
    perform private.notify(array[new.assigned_to], new.id, actor, 'reassigned', who || ' has assigned ' || t || ' to you');
    perform private.notify(
      array(select unnest(admins || case when by_assignee then array[old.assigned_by] else '{}'::uuid[] end)
            except select new.assigned_to),
      new.id, actor, 'reassigned',
      who || case when old.assigned_to is null then ' has assigned ' else ' has reassigned ' end || t || ' to ' || private.person_name(new.assigned_to));
    return new;
  end if;

  if not by_assignee then return new; end if;

  if new.status is distinct from old.status then
    perform private.notify(admins || new.assigned_by, new.id, actor, 'status',
      who || ' changed the status of ' || t || ' to ' || private.status_label(new.status::text));
  end if;

  if new.title is distinct from old.title then changes := changes || 'title'::text; end if;
  if new.description is distinct from old.description then changes := changes || 'description'::text; end if;
  if new.due_date is distinct from old.due_date then changes := changes || 'due date'::text; end if;
  if new.priority is distinct from old.priority then changes := changes || 'priority'::text; end if;
  if new.start_time is distinct from old.start_time or new.end_time is distinct from old.end_time then
    changes := changes || 'time'::text;
  end if;
  if array_length(changes, 1) > 0 then
    perform private.notify(admins || new.assigned_by, new.id, actor, 'updated',
      who || ' updated the ' || array_to_string(changes, ', ') || ' of ' || t);
  end if;
  return new;
end $$;

-- WhatsApp "task assigned": nothing to send while there's no assignee.
create or replace function private.wa_task_assigned() returns trigger
language plpgsql security definer set search_path = '' as $$
declare actor uuid := coalesce((select auth.uid()), new.assigned_by);
begin
  if new.recurring_id is not null then return new; end if;
  if new.assigned_to is null then return new; end if;
  if tg_op = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to then return new; end if;
  if new.assigned_to = actor then return new; end if;
  perform private.wa_enqueue('task_assigned', new.assigned_to, jsonb_build_object(
    'name', private.wa_text(private.person_name(new.assigned_to), 60),
    'assigner', private.wa_text(private.person_name(actor), 60),
    'task', 'TM-' || new.task_no || ' – ' || private.wa_text(new.title, 120),
    'due', private.wa_due_text(new.due_date, new.start_time, new.end_time),
    'link', private.setting('app_url') || '/tasks?task=' || new.id
  ), new.id);
  return new;
end $$;

-- Activity log: show "Unassigned" instead of a blank name.
create or replace function private.tasks_log_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    insert into public.task_activity (task_id, actor_id, action, new_value)
    values (new.id, coalesce(actor, new.assigned_by), 'created', new.title);
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.task_activity (task_id, actor_id, action, old_value, new_value)
    values (new.id, actor, 'status', old.status::text, new.status::text);
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.task_activity (task_id, actor_id, action, old_value, new_value)
    values (new.id, actor, 'assigned_to',
      coalesce((select full_name from public.profiles where id = old.assigned_to), 'Unassigned'),
      coalesce((select full_name from public.profiles where id = new.assigned_to), 'Unassigned'));
  end if;
  if new.due_date is distinct from old.due_date then
    insert into public.task_activity (task_id, actor_id, action, old_value, new_value)
    values (new.id, actor, 'due_date', old.due_date::text, new.due_date::text);
  end if;
  if new.priority is distinct from old.priority then
    insert into public.task_activity (task_id, actor_id, action, old_value, new_value)
    values (new.id, actor, 'priority', old.priority::text, new.priority::text);
  end if;
  if new.title is distinct from old.title then
    insert into public.task_activity (task_id, actor_id, action, old_value, new_value)
    values (new.id, actor, 'title', old.title, new.title);
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Perisclaw: a row became a task with no assignee → tell every active admin
-- (WhatsApp template `task_unassigned` + bell notification).
-- ---------------------------------------------------------------------
create or replace function private.perisclaw_unassigned_alert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t record;
  person text := coalesce(nullif(btrim(new.parsed->>'assignee_text'), ''), 'no name given');
  a uuid;
begin
  if new.status <> 'created' or new.task_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'created' and old.task_id is not distinct from new.task_id then return new; end if;
  select id, task_no, title, assigned_to into t from public.tasks where id = new.task_id;
  if not found or t.assigned_to is not null then return new; end if;

  foreach a in array private.active_admins() loop
    perform private.wa_enqueue('task_unassigned', a, jsonb_build_object(
      'name', private.wa_text(private.person_name(a), 60),
      'person', private.wa_text(person, 60),
      'task', 'TM-' || t.task_no || ' – ' || private.wa_text(t.title, 120),
      'link', private.setting('app_url') || '/tasks?task=' || t.id
    ), t.id);
  end loop;
  perform private.notify(private.active_admins(), t.id, null, 'unassigned',
    'Perisclaw added "' || t.title || '" but "' || person || '" is not a user yet. Create the user and assign this task.');
  return new;
end $$;

create trigger perisclaw_unassigned_alert after insert or update of status, task_id on public.perisclaw_entries
  for each row execute function private.perisclaw_unassigned_alert();

-- ===== supabase/migrations/20260930120000_whatsapp_config_in_app.sql =====
-- =====================================================================
-- WATI connection set from the app (Settings → WhatsApp Logs), so nobody
-- has to open Supabase. The access token is kept encrypted in Supabase
-- Vault and can never be read back by the browser: admins can only set,
-- replace or remove it, and see its last 4 characters.
-- The Edge Function `whatsapp-sender` reads it with whatsapp_get_config()
-- (service role only). If nothing is saved here it falls back to the
-- WATI_TOKEN / WATI_API_URL Edge Function secrets.
-- =====================================================================

-- Admin: save the WATI API URL and/or token.
--   p_token: new token (null/empty = keep the current one)
--   p_api_url: WATI API endpoint (null = keep, '' = use the default)
--   p_clear_token: true = remove the saved token
create or replace function public.whatsapp_set_config(p_token text default null, p_api_url text default null, p_clear_token boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  tok text := nullif(btrim(regexp_replace(coalesce(p_token, ''), '^\s*bearer\s+', '', 'i')), '');
  url text := btrim(coalesce(p_api_url, ''));
  sid uuid;
begin
  if not private.is_admin() then raise exception 'Only admins can change the WhatsApp settings'; end if;

  if p_api_url is not null then
    if url = '' then
      delete from private.app_settings where key = 'wati_api_url';
    else
      url := regexp_replace(url, '/+$', '');
      if url !~* '^https://[a-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~/-]*)?$' then
        raise exception 'The API URL should look like https://live-mt-server.wati.io/123456 (WATI → API Docs)';
      end if;
      insert into private.app_settings (key, value) values ('wati_api_url', url)
        on conflict (key) do update set value = excluded.value;
    end if;
  end if;

  if p_clear_token then
    delete from vault.secrets where name = 'wati_token';
    delete from private.app_settings where key in ('wati_token_hint', 'wati_token_saved_at');
  elsif tok is not null then
    if length(tok) < 20 or tok ~ '\s' then raise exception 'That doesn''t look like a WATI access token. Copy it from WATI → API Docs.'; end if;
    select id into sid from vault.secrets where name = 'wati_token';
    if sid is null then
      perform vault.create_secret(tok, 'wati_token', 'WATI access token (set from Task Mgnt)');
    else
      perform vault.update_secret(sid, tok);
    end if;
    insert into private.app_settings (key, value) values
      ('wati_token_hint', right(tok, 4)), ('wati_token_saved_at', now()::text)
      on conflict (key) do update set value = excluded.value;
  end if;

  return public.whatsapp_config_status();
end $$;

-- Admin: what's saved (never the token itself).
create or replace function public.whatsapp_config_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Only admins can see the WhatsApp settings'; end if;
  return jsonb_build_object(
    'token_saved', exists (select 1 from vault.secrets where name = 'wati_token'),
    'token_hint', (select value from private.app_settings where key = 'wati_token_hint'),
    'token_saved_at', (select value from private.app_settings where key = 'wati_token_saved_at'),
    'api_url', (select value from private.app_settings where key = 'wati_api_url'));
end $$;

-- Edge Function only: the saved token and URL.
create or replace function public.whatsapp_get_config()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'token', (select decrypted_secret from vault.decrypted_secrets where name = 'wati_token' limit 1),
    'api_url', (select value from private.app_settings where key = 'wati_api_url'))
$$;

revoke all on function public.whatsapp_set_config(text, text, boolean) from public, anon;
revoke all on function public.whatsapp_config_status() from public, anon;
revoke all on function public.whatsapp_get_config() from public, anon, authenticated;
grant execute on function public.whatsapp_set_config(text, text, boolean) to authenticated;
grant execute on function public.whatsapp_config_status() to authenticated;
grant execute on function public.whatsapp_get_config() to service_role;

-- ===== supabase/migrations/20260930130000_perisclaw_wait.sql =====
-- Perisclaw: new rows first wait 2 minutes (status 'waiting') before they become tasks,
-- because Perisclaw often edits a row a minute or two after writing it. If the row is edited
-- during the wait, the old version is dropped and only the edited row becomes a task.
alter table public.perisclaw_entries drop constraint perisclaw_entries_status_check;
alter table public.perisclaw_entries add constraint perisclaw_entries_status_check
  check (status in ('waiting', 'processing', 'created', 'needs_review', 'ignored', 'skipped_existing', 'error'));

-- ===== supabase/migrations/20260930140000_perisclaw_edit_no_realert.sql =====
-- Perisclaw: an edited sheet row now updates the task it already made (it links to the same task).
-- Don't send the "user not found" WhatsApp/bell again for that same task.
create or replace function private.perisclaw_unassigned_alert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t record;
  person text := coalesce(nullif(btrim(new.parsed->>'assignee_text'), ''), 'no name given');
  a uuid;
begin
  if new.status <> 'created' or new.task_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'created' and old.task_id is not distinct from new.task_id then return new; end if;
  -- Another row (an earlier version of this one) already made this task: admins were told then.
  if exists (select 1 from public.perisclaw_entries e where e.task_id = new.task_id and e.id <> new.id) then return new; end if;
  select id, task_no, title, assigned_to into t from public.tasks where id = new.task_id;
  if not found or t.assigned_to is not null then return new; end if;

  foreach a in array private.active_admins() loop
    perform private.wa_enqueue('task_unassigned', a, jsonb_build_object(
      'name', private.wa_text(private.person_name(a), 60),
      'person', private.wa_text(person, 60),
      'task', 'TM-' || t.task_no || ' – ' || private.wa_text(t.title, 120),
      'link', private.setting('app_url') || '/tasks?task=' || t.id
    ), t.id);
  end loop;
  perform private.notify(private.active_admins(), t.id, null, 'unassigned',
    'Perisclaw added "' || t.title || '" but "' || person || '" is not a user yet. Create the user and assign this task.');
  return new;
end $$;

-- ===== supabase/migrations/20260930150000_task_reminders.sql =====
-- =====================================================================
-- v1.3 Reminders.
-- A reminder tells someone about a task at a set time: "N minutes/hours before
-- the deadline" (moves with the task's date/time) or at an exact date & time.
--   * Deadline = due date + end time, or 7:00 pm IST if the task has no time.
--   * Sent on WhatsApp (template `task_reminder`) and as a bell notification.
--   * Not sent if the task is already Done. Recurring tasks have no reminders.
--   * Automatic reminders per priority (reminder_rules, editable by admins in
--     Settings → Reminders) are added to every new one-time task.
--   * Who may add: anyone who can see the task can remind themselves; the
--     assigner, the creator or an admin can also remind the assignee or others.
-- =====================================================================

-- ---------- Automatic reminders per priority ----------
create table public.reminder_rules (
  priority public.task_priority primary key,
  assignee_minutes int check (assignee_minutes between 5 and 10080),   -- remind the assignee N min before the deadline (null = no)
  assigner_minutes int check (assigner_minutes between 5 and 10080),   -- remind whoever assigned it N min before (null = no)
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
insert into public.reminder_rules (priority, assignee_minutes, assigner_minutes) values
  ('urgent', 120, 60), ('high', 120, null), ('medium', null, null), ('low', null, null);

alter table public.reminder_rules enable row level security;
create policy "reminder rules read" on public.reminder_rules for select to authenticated using (true);
create policy "reminder rules admin update" on public.reminder_rules for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
revoke all on public.reminder_rules from anon;
revoke insert, delete on public.reminder_rules from authenticated;
grant select, update on public.reminder_rules to authenticated;

create or replace function private.reminder_rules_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.priority := old.priority;
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  return new;
end $$;
create trigger reminder_rules_before before update on public.reminder_rules
  for each row execute function private.reminder_rules_before();

-- ---------- Reminders ----------
create table public.task_reminders (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  target text not null check (target in ('assignee', 'person')),   -- assignee = whoever has the task when it's sent
  person_id uuid references public.profiles(id) on delete cascade,
  minutes_before int check (minutes_before between 5 and 10080),
  remind_at timestamptz,
  auto boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  skipped text,                                                       -- why it wasn't sent
  check ((minutes_before is null) <> (remind_at is null)),
  check (target = 'assignee' or person_id is not null)
);
create index task_reminders_task_idx on public.task_reminders (task_id);
create index task_reminders_pending_idx on public.task_reminders (created_at) where sent_at is null and skipped is null;

/** The moment a task is due: its end time on the due date, or 7:00 pm IST if it has no time. */
create or replace function private.reminder_deadline(p_due date, p_end time) returns timestamptz
language sql immutable set search_path = '' as $$
  select case when p_due is null then null
    else ((p_due + coalesce(p_end, time '19:00')) at time zone 'Asia/Kolkata') end
$$;

/** "in 2 hours", "in 45 minutes", "in 1 day", "now". */
create or replace function private.human_until(p timestamptz) returns text
language sql stable set search_path = '' as $$
  select case
    when p is null then ''
    when p - now() < interval '1 minute' then 'now'
    when p - now() < interval '1 hour' then 'in ' || ceil(extract(epoch from p - now()) / 60)::int || ' minutes'
    when p - now() < interval '1 day' then 'in ' || round(extract(epoch from p - now()) / 3600)::int
         || case when round(extract(epoch from p - now()) / 3600)::int = 1 then ' hour' else ' hours' end
    else 'in ' || round(extract(epoch from p - now()) / 86400)::int
         || case when round(extract(epoch from p - now()) / 86400)::int = 1 then ' day' else ' days' end
  end
$$;

-- Checks on every new reminder (who may add what).
create or replace function private.task_reminders_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  t record;
begin
  select id, recurring_id, due_date, assigned_by, assigned_to, created_by into t from public.tasks where id = new.task_id;
  if not found then raise exception 'Task not found'; end if;
  if t.recurring_id is not null then raise exception 'Recurring tasks don''t have reminders'; end if;
  if new.minutes_before is not null and t.due_date is null then raise exception 'This task has no due date, so pick an exact time'; end if;
  new.sent_at := null; new.skipped := null;
  -- Added directly by a person (not by the automatic-reminder trigger on tasks, which runs one level deeper).
  if me is not null and pg_trigger_depth() = 1 then
    new.auto := false;
    new.created_by := me;
    if not private.can_see_task(new.task_id) then raise exception 'You can''t see this task'; end if;
    if not (private.is_admin() or me in (t.assigned_by, t.created_by)
            or (new.target = 'person' and new.person_id = me)
            or (new.target = 'assignee' and t.assigned_to = me)) then
      raise exception 'You can set reminders for yourself only';
    end if;
  end if;
  if new.target = 'assignee' then new.person_id := null; end if;
  if new.target = 'person' and not exists (select 1 from public.profiles where id = new.person_id and is_active) then
    raise exception 'Reminders can only go to active users';
  end if;
  return new;
end $$;
create trigger task_reminders_before before insert on public.task_reminders
  for each row execute function private.task_reminders_before();

alter table public.task_reminders enable row level security;
create policy "task reminders read" on public.task_reminders for select to authenticated
  using ((select private.can_see_task(task_id)));
create policy "task reminders add" on public.task_reminders for insert to authenticated
  with check ((select private.can_see_task(task_id)));
create policy "task reminders remove" on public.task_reminders for delete to authenticated
  using ((select private.is_admin()) or created_by = (select auth.uid()) or person_id = (select auth.uid())
    or exists (select 1 from public.tasks t where t.id = task_id and (select auth.uid()) in (t.assigned_by, t.created_by)));
revoke all on public.task_reminders from anon;
revoke update on public.task_reminders from authenticated;
grant select, insert, delete on public.task_reminders to authenticated;

-- ---------- Automatic reminders on new tasks (and when the priority changes) ----------
create or replace function private.tasks_auto_reminders() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if new.recurring_id is not null or new.due_date is null then return new; end if;
  if tg_op = 'UPDATE' then
    if new.priority is not distinct from old.priority then return new; end if;
    delete from public.task_reminders where task_id = new.id and auto and sent_at is null and skipped is null;
  end if;
  select * into r from public.reminder_rules where priority = new.priority;
  if not found then return new; end if;
  if r.assignee_minutes is not null then
    insert into public.task_reminders (task_id, target, minutes_before, auto) values (new.id, 'assignee', r.assignee_minutes, true);
  end if;
  -- The assigner's reminder (skipped when they gave the task to themselves: the assignee one covers it).
  if r.assigner_minutes is not null and new.assigned_by is distinct from new.assigned_to then
    insert into public.task_reminders (task_id, target, person_id, minutes_before, auto)
    values (new.id, 'person', new.assigned_by, r.assigner_minutes, true);
  end if;
  return new;
end $$;
create trigger tasks_auto_reminders after insert or update of priority on public.tasks
  for each row execute function private.tasks_auto_reminders();

-- ---------- Sending ----------
alter table public.whatsapp_outbox drop constraint whatsapp_outbox_kind_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_kind_check
  check (kind in ('task_assigned', 'task_comment', 'daily_task_report', 'task_unassigned', 'task_reminder'));

/** "01-Oct-2026, 10:00 AM - 11:00 AM", or "01-Oct-2026, 07:00 PM" for a task with no time (its reminder deadline). */
create or replace function private.reminder_due_text(p_due date, p_start time, p_end time) returns text
language sql immutable set search_path = '' as $$
  select case when p_end is null and p_due is not null then to_char(p_due, 'DD-Mon-YYYY') || ', 07:00 PM'
    else private.wa_due_text(p_due, p_start, p_end) end
$$;

/** Every minute: send reminders whose time has come (WhatsApp + bell). */
create or replace function private.send_due_reminders() returns int
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  fire timestamptz;
  deadline timestamptz;
  who uuid;
  why text;
  sent int := 0;
begin
  for r in
    select rm.id, rm.target, rm.person_id, rm.minutes_before, rm.remind_at, rm.auto, rm.created_at,
           t.id as task_id, t.task_no, t.title, t.status, t.due_date, t.start_time, t.end_time, t.assigned_to
      from public.task_reminders rm join public.tasks t on t.id = rm.task_id
     where rm.sent_at is null and rm.skipped is null
       and coalesce(rm.remind_at, private.reminder_deadline(t.due_date, t.end_time) - make_interval(mins => rm.minutes_before)) <= now()
     order by rm.created_at
     for update of rm skip locked
     limit 200
  loop
    deadline := private.reminder_deadline(r.due_date, r.end_time);
    fire := coalesce(r.remind_at, deadline - make_interval(mins => r.minutes_before));
    who := case r.target when 'assignee' then r.assigned_to else r.person_id end;
    why := case
      when r.status = 'done' then 'Task was already done'
      when who is null then 'Task had no assignee'
      when r.minutes_before is not null and deadline < now() then 'Deadline had already passed'
      when r.auto and fire < r.created_at then 'Task was added too close to the deadline for this reminder'
      when fire < now() - interval '3 hours' then 'Missed (more than 3 hours late)'
    end;
    if why is not null then
      update public.task_reminders set skipped = why where id = r.id;
      continue;
    end if;
    perform private.wa_enqueue('task_reminder', who, jsonb_build_object(
      'name', private.wa_text(private.person_name(who), 60),
      'task', 'TM-' || r.task_no || ' – ' || private.wa_text(r.title, 120),
      'due', private.reminder_due_text(r.due_date, r.start_time, r.end_time)
             || case when deadline > now() then ' (' || private.human_until(deadline) || ')' else '' end,
      'status', private.status_label(r.status::text),
      'link', private.setting('app_url') || '/tasks?task=' || r.task_id
    ), r.task_id);
    perform private.notify(array[who], r.task_id, null, 'reminder',
      'Reminder: "' || r.title || '" is due ' || private.reminder_due_text(r.due_date, r.start_time, r.end_time)
      || case when deadline > now() then ' (' || private.human_until(deadline) || ')' else '' end
      || '. Status: ' || private.status_label(r.status::text));
    update public.task_reminders set sent_at = now() where id = r.id;
    sent := sent + 1;
  end loop;
  return sent;
end $$;

select cron.schedule('task-reminders', '* * * * *', $$select private.send_due_reminders()$$);

-- ===== supabase/migrations/20260930160000_reminders_recheck.sql =====
-- Reminders: when a task's date, time, status or assignee changes, give its skipped (unsent) reminders
-- another chance. E.g. an automatic reminder skipped because the task was due too soon becomes pending
-- again when the deadline is moved later. The minute job re-checks them against the new values.
create or replace function private.tasks_reminders_recheck() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if row(new.due_date, new.end_time, new.status, new.assigned_to) is not distinct from row(old.due_date, old.end_time, old.status, old.assigned_to) then
    return new;
  end if;
  if new.status = 'done' or private.reminder_deadline(new.due_date, new.end_time) <= now() then return new; end if;
  update public.task_reminders set skipped = null
   where task_id = new.id and sent_at is null and skipped is not null;
  return new;
end $$;
create trigger tasks_reminders_recheck after update of due_date, end_time, status, assigned_to on public.tasks
  for each row execute function private.tasks_reminders_recheck();

-- The "too close" rule compares the reminder time with when the reminder was made; after a date change
-- that's still right: a reminder whose new time is after it was made will be sent.

-- ===== supabase/migrations/20261001120000_web_push.sql =====
-- 1.4 — Reminders as phone notifications (Web Push) instead of WhatsApp.
-- Reminders now go to: the bell (Notifications → Reminders tab) + a push notification on every phone/browser
-- where the person turned notifications on. Task assigned / comments stay on WhatsApp + bell.

-- ---------- Where to send: one row per browser / installed app that allowed notifications ----------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  last_error text
);
create index push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "own push subscriptions read" on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own push subscriptions add" on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own push subscriptions remove" on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.push_subscriptions from anon;
revoke update on public.push_subscriptions from authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;

/** Save this browser's subscription for me (re-subscribing on the same endpoint moves it to me / refreshes keys). */
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'Not signed in'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (me, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update set user_id = me, p256dh = excluded.p256dh, auth = excluded.auth,
    user_agent = excluded.user_agent, last_error = null;
end $$;

-- ---------- Queue of push messages (sent by the push-sender Edge Function) ----------
create table public.push_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  title text not null,
  body text not null,
  url text,
  tag text,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'no_device', 'failed')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index push_outbox_queued on public.push_outbox (created_at) where status = 'queued';
alter table public.push_outbox enable row level security;
create policy "push outbox admin read" on public.push_outbox for select to authenticated using ((select private.is_admin()));
revoke all on public.push_outbox from anon, authenticated;
grant select on public.push_outbox to authenticated;

/** Edge Function: take up to n queued messages with the devices to send them to. */
create or replace function public.push_claim_batch(p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  -- Messages stuck in 'sending' (function crashed) go back to the queue after 5 minutes.
  update public.push_outbox set status = 'queued' where status = 'sending' and sent_at is null and created_at < now() - interval '5 minutes';
  with picked as (
    select id from public.push_outbox where status = 'queued' and created_at > now() - interval '3 hours'
    order by created_at limit p_limit for update skip locked
  ), upd as (
    update public.push_outbox o set status = 'sending', attempts = attempts + 1 from picked where o.id = picked.id
    returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', u.id, 'title', u.title, 'body', u.body, 'url', u.url, 'tag', u.tag,
    'subs', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]')
             from public.push_subscriptions s where s.user_id = u.user_id))), '[]')
    into out from upd u;
  -- Too old to be useful.
  update public.push_outbox set status = 'failed', last_error = 'Expired (not sent within 3 hours)'
   where status = 'queued' and created_at <= now() - interval '3 hours';
  return out;
end $$;

/** Edge Function: result per message, and per device (gone devices are removed). */
create or replace function public.push_mark(p_id uuid, p_status text, p_error text default null,
  p_ok_subs uuid[] default '{}', p_gone_subs uuid[] default '{}', p_failed_subs jsonb default '{}')
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.push_outbox set
    status = case when p_status = 'retry' and attempts < 3 then 'queued' when p_status = 'retry' then 'failed' else p_status end,
    last_error = p_error, sent_at = case when p_status = 'sent' then now() end
  where id = p_id;
  update public.push_subscriptions set last_ok_at = now(), last_error = null where id = any(p_ok_subs);
  delete from public.push_subscriptions where id = any(p_gone_subs);
  update public.push_subscriptions s set last_error = left(p_failed_subs ->> s.id::text, 300)
   where s.id::text in (select jsonb_object_keys(p_failed_subs));
end $$;

-- ---------- VAPID keys (identify our server to the push services). Made once by push-sender, kept in Vault. ----------
create or replace function public.push_get_keys() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'public', (select value from private.app_settings where key = 'vapid_public_key'),
    'private', (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_private_key' limit 1),
    'subject', coalesce((select value from private.app_settings where key = 'app_url'), 'https://pride.viralsakhiya.com'))
$$;

create or replace function public.push_set_keys(p_public text, p_private text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from private.app_settings where key = 'vapid_public_key') then return; end if;   -- never replace: devices are tied to it
  perform vault.create_secret(p_private, 'vapid_private_key', 'Web Push (VAPID) private key for push-sender');
  insert into private.app_settings (key, value) values ('vapid_public_key', p_public);
end $$;

/** The app needs the public key to subscribe a browser. */
create or replace function public.push_public_key() returns text
language sql stable security definer set search_path = '' as $$
  select value from private.app_settings where key = 'vapid_public_key'
$$;

revoke all on function public.push_subscribe(text, text, text, text) from public, anon;
revoke all on function public.push_claim_batch(int) from public, anon, authenticated;
revoke all on function public.push_mark(uuid, text, text, uuid[], uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.push_get_keys() from public, anon, authenticated;
revoke all on function public.push_set_keys(text, text) from public, anon, authenticated;
revoke all on function public.push_public_key() from public, anon;
grant execute on function public.push_subscribe(text, text, text, text) to authenticated;
grant execute on function public.push_public_key() to authenticated;
grant execute on function public.push_claim_batch(int), public.push_mark(uuid, text, text, uuid[], uuid[], jsonb),
  public.push_get_keys(), public.push_set_keys(text, text) to service_role;

/** Call push-sender right away when there's something to send (same idea as wa_kick). */
create or replace function private.push_kick() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.push_outbox where status = 'queued') then
    perform net.http_post(
      url := 'https://tazlvzjalhxsudceabqy.supabase.co/functions/v1/push-sender',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 30000);
  end if;
end $$;

-- ---------- Reminders: bell + push (no more WhatsApp) ----------
create or replace function private.send_due_reminders() returns int
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  fire timestamptz;
  deadline timestamptz;
  who uuid;
  why text;
  due text;
  sent int := 0;
begin
  for r in
    select rm.id, rm.target, rm.person_id, rm.minutes_before, rm.remind_at, rm.auto, rm.created_at,
           t.id as task_id, t.task_no, t.title, t.status, t.due_date, t.start_time, t.end_time, t.assigned_to
      from public.task_reminders rm join public.tasks t on t.id = rm.task_id
     where rm.sent_at is null and rm.skipped is null
       and coalesce(rm.remind_at, private.reminder_deadline(t.due_date, t.end_time) - make_interval(mins => rm.minutes_before)) <= now()
     order by rm.created_at
     for update of rm skip locked
     limit 200
  loop
    deadline := private.reminder_deadline(r.due_date, r.end_time);
    fire := coalesce(r.remind_at, deadline - make_interval(mins => r.minutes_before));
    who := case r.target when 'assignee' then r.assigned_to else r.person_id end;
    why := case
      when r.status = 'done' then 'Task was already done'
      when who is null then 'Task had no assignee'
      when r.minutes_before is not null and deadline < now() then 'Deadline had already passed'
      when r.auto and fire < r.created_at then 'Task was added too close to the deadline for this reminder'
      when fire < now() - interval '3 hours' then 'Missed (more than 3 hours late)'
    end;
    if why is not null then
      update public.task_reminders set skipped = why where id = r.id;
      continue;
    end if;
    due := private.reminder_due_text(r.due_date, r.start_time, r.end_time)
           || case when deadline > now() then ' (' || private.human_until(deadline) || ')' else '' end;
    perform private.notify(array[who], r.task_id, null, 'reminder',
      'Reminder: "' || r.title || '" is due ' || due || '. Status: ' || private.status_label(r.status::text));
    if exists (select 1 from public.profiles where id = who and is_active) then
      insert into public.push_outbox (user_id, task_id, title, body, url, tag)
      values (who, r.task_id,
        '⏰ TM-' || r.task_no || ' · ' || left(r.title, 80),
        'Due ' || due || ' · ' || private.status_label(r.status::text),
        '/tasks?task=' || r.task_id,
        'reminder-' || r.id);
    end if;
    update public.task_reminders set sent_at = now() where id = r.id;
    sent := sent + 1;
  end loop;
  if sent > 0 then perform private.push_kick(); end if;
  return sent;
end $$;

-- Safety net: send anything still queued every minute (e.g. if the instant call failed).
select cron.schedule('push-sender', '* * * * *', $$select private.push_kick()$$);

-- ===== supabase/migrations/20261001130000_push_test.sql =====
-- "Send a test notification" (My Profile → Phone Notifications): queues a push to my own devices.
create or replace function public.push_test() returns int
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); n int;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select count(*) into n from public.push_subscriptions where user_id = me;
  if n = 0 then raise exception 'Phone notifications are not turned on on any of your devices yet'; end if;
  insert into public.push_outbox (user_id, title, body, url, tag)
  values (me, '⏰ Test reminder', 'Phone notifications are working. Reminders for your tasks will show up like this.', '/notifications?tab=reminders', 'test-' || me);
  perform private.push_kick();
  return n;
end $$;
revoke all on function public.push_test() from public, anon;
grant execute on function public.push_test() to authenticated;

-- ===== supabase/migrations/20261001140000_push_tasks_comments.sql =====
-- 1.4.1 — Phone notifications also for "task assigned to you" and comments (WhatsApp + bell stay as they are).
-- Follows the bell: every new notification of these types also queues a push for that person, if they turned
-- phone notifications on (no device = nothing queued).
create or replace function private.notifications_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t record; push_title text;
begin
  if new.type not in ('assigned', 'comment') or new.task_id is null then return new; end if;
  if not exists (select 1 from public.push_subscriptions s where s.user_id = new.user_id) then return new; end if;
  select tk.id, tk.task_no, tk.title, tk.assigned_to into t from public.tasks tk where tk.id = new.task_id;
  if not found then return new; end if;
  -- "assigned" bells also go to admins ("X assigned … to Y"); only the new assignee gets a phone notification.
  if new.type = 'assigned' and t.assigned_to is distinct from new.user_id then return new; end if;
  push_title := case new.type when 'assigned' then '📋 New task · TM-' else '💬 TM-' end || t.task_no || ' · ' || left(t.title, 70);
  insert into public.push_outbox (user_id, task_id, title, body, url, tag)
  values (new.user_id, t.id, push_title, left(new.message, 300), '/tasks?task=' || t.id,
          case new.type when 'comment' then 'comment-' || t.id else 'assigned-' || t.id end);
  perform private.push_kick();
  return new;
end $$;

create trigger notifications_push after insert on public.notifications
  for each row execute function private.notifications_push();

-- ===== supabase/migrations/20261001150000_reminder_anchor.sql =====
-- 1.5.1 — Reminders can be before OR after, the task's START or END.
-- task_reminders: minutes_before stays the amount (always positive); new `direction` (before/after) and `anchor` (start/end).
-- End = the deadline (end time, or 7:00 pm IST if no time). Start = the start time on the due date; a task without
-- a start time has no start, so start-based reminders aren't sent for it ("Task has no start time").
-- reminder_rules get the same choice per column. Existing reminders/rules keep their meaning (before the end).

alter table public.task_reminders
  add column direction text not null default 'before' check (direction in ('before', 'after')),
  add column anchor text not null default 'end' check (anchor in ('start', 'end'));

alter table public.reminder_rules
  add column assignee_direction text not null default 'before' check (assignee_direction in ('before', 'after')),
  add column assignee_anchor text not null default 'end' check (assignee_anchor in ('start', 'end')),
  add column assigner_direction text not null default 'before' check (assigner_direction in ('before', 'after')),
  add column assigner_anchor text not null default 'end' check (assigner_anchor in ('start', 'end'));

-- "0 min" = right at the start / end.
alter table public.task_reminders drop constraint task_reminders_minutes_before_check;
alter table public.task_reminders add constraint task_reminders_minutes_before_check check (minutes_before between 0 and 10080);
alter table public.reminder_rules drop constraint reminder_rules_assignee_minutes_check;
alter table public.reminder_rules add constraint reminder_rules_assignee_minutes_check check (assignee_minutes between 0 and 10080);
alter table public.reminder_rules drop constraint reminder_rules_assigner_minutes_check;
alter table public.reminder_rules add constraint reminder_rules_assigner_minutes_check check (assigner_minutes between 0 and 10080);

/** The task's start as a moment (start time on the due date, IST), or null when it has no start time. */
create or replace function private.task_start(p_due date, p_start time) returns timestamptz
language sql immutable set search_path = '' as $$
  select case when p_due is null or p_start is null then null
              else (p_due + p_start) at time zone 'Asia/Kolkata' end
$$;

/** When a reminder fires: its exact time, or N minutes before/after the task's start/end. Null = never (no start time). */
create or replace function private.reminder_fire_at(p_remind_at timestamptz, p_minutes int, p_direction text, p_anchor text,
  p_due date, p_start time, p_end time) returns timestamptz
language sql immutable set search_path = '' as $$
  select case
    when p_remind_at is not null then p_remind_at
    else (case p_anchor when 'start' then private.task_start(p_due, p_start) else private.reminder_deadline(p_due, p_end) end)
         + case p_direction when 'after' then 1 else -1 end * make_interval(mins => p_minutes)
  end
$$;

/** "in 2 hours" for the future, "30 minutes ago" for the past. */
create or replace function private.human_rel(p timestamptz) returns text
language sql stable set search_path = '' as $$
  select case
    when p is null then ''
    when p >= now() then private.human_until(p)
    when now() - p < interval '1 minute' then 'just now'
    when now() - p < interval '1 hour' then ceil(extract(epoch from now() - p) / 60)::int || ' minutes ago'
    when now() - p < interval '1 day' then round(extract(epoch from now() - p) / 3600)::int
         || case when round(extract(epoch from now() - p) / 3600)::int = 1 then ' hour ago' else ' hours ago' end
    else round(extract(epoch from now() - p) / 86400)::int
         || case when round(extract(epoch from now() - p) / 86400)::int = 1 then ' day ago' else ' days ago' end
  end
$$;

-- Validation: direction/anchor only make sense for "minutes" reminders; start needs… a start (checked when sending).
create or replace function private.task_reminders_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  t record;
begin
  select id, recurring_id, due_date, assigned_by, assigned_to, created_by into t from public.tasks where id = new.task_id;
  if not found then raise exception 'Task not found'; end if;
  if t.recurring_id is not null then raise exception 'Recurring tasks don''t have reminders'; end if;
  if new.minutes_before is not null and t.due_date is null then raise exception 'This task has no due date, so pick an exact time'; end if;
  if new.remind_at is not null then new.direction := 'before'; new.anchor := 'end'; end if;
  new.sent_at := null; new.skipped := null;
  if me is not null and pg_trigger_depth() = 1 then
    new.auto := false;
    new.created_by := me;
    if not private.can_see_task(new.task_id) then raise exception 'You can''t see this task'; end if;
    if not (private.is_admin() or me in (t.assigned_by, t.created_by)
            or (new.target = 'person' and new.person_id = me)
            or (new.target = 'assignee' and t.assigned_to = me)) then
      raise exception 'You can set reminders for yourself only';
    end if;
  end if;
  if new.target = 'assignee' then new.person_id := null; end if;
  if new.target = 'person' and not exists (select 1 from public.profiles where id = new.person_id and is_active) then
    raise exception 'Reminders can only go to active users';
  end if;
  return new;
end $$;

-- Automatic reminders carry the rule's direction/anchor.
create or replace function private.tasks_auto_reminders() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if new.recurring_id is not null or new.due_date is null then return new; end if;
  if tg_op = 'UPDATE' then
    if new.priority is not distinct from old.priority then return new; end if;
    delete from public.task_reminders where task_id = new.id and auto and sent_at is null and skipped is null;
  end if;
  select * into r from public.reminder_rules where priority = new.priority;
  if not found then return new; end if;
  if r.assignee_minutes is not null then
    insert into public.task_reminders (task_id, target, minutes_before, direction, anchor, auto)
    values (new.id, 'assignee', r.assignee_minutes, r.assignee_direction, r.assignee_anchor, true);
  end if;
  if r.assigner_minutes is not null and new.assigned_by is distinct from new.assigned_to then
    insert into public.task_reminders (task_id, target, person_id, minutes_before, direction, anchor, auto)
    values (new.id, 'person', new.assigned_by, r.assigner_minutes, r.assigner_direction, r.assigner_anchor, true);
  end if;
  return new;
end $$;

-- Re-open skipped reminders when the date/times/status/assignee change (the sender re-checks them).
create or replace function private.tasks_reminders_recheck() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if row(new.due_date, new.start_time, new.end_time, new.status, new.assigned_to)
     is not distinct from row(old.due_date, old.start_time, old.end_time, old.status, old.assigned_to) then
    return new;
  end if;
  if new.status = 'done' then return new; end if;
  update public.task_reminders set skipped = null
   where task_id = new.id and sent_at is null and skipped is not null;
  return new;
end $$;
drop trigger if exists tasks_reminders_recheck on public.tasks;
create trigger tasks_reminders_recheck after update of due_date, start_time, end_time, status, assigned_to on public.tasks
  for each row execute function private.tasks_reminders_recheck();

-- Sending (bell + phone notification).
create or replace function private.send_due_reminders() returns int
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  fire timestamptz;
  pivot timestamptz;
  who uuid;
  why text;
  what text;
  sent int := 0;
begin
  -- Start-based reminders on a task with no start time can never fire: mark them once the due date is here.
  update public.task_reminders rm set skipped = 'Task has no start time'
    from public.tasks t
   where t.id = rm.task_id and rm.sent_at is null and rm.skipped is null and rm.remind_at is null
     and rm.anchor = 'start' and t.start_time is null and t.due_date <= private.today_ist();

  for r in
    select rm.id, rm.target, rm.person_id, rm.minutes_before, rm.direction, rm.anchor, rm.remind_at, rm.auto, rm.created_at,
           t.id as task_id, t.task_no, t.title, t.status, t.due_date, t.start_time, t.end_time, t.assigned_to
      from public.task_reminders rm join public.tasks t on t.id = rm.task_id
     where rm.sent_at is null and rm.skipped is null
       and private.reminder_fire_at(rm.remind_at, rm.minutes_before, rm.direction, rm.anchor, t.due_date, t.start_time, t.end_time) <= now()
     order by rm.created_at
     for update of rm skip locked
     limit 200
  loop
    fire := private.reminder_fire_at(r.remind_at, r.minutes_before, r.direction, r.anchor, r.due_date, r.start_time, r.end_time);
    pivot := case when r.anchor = 'start' and r.remind_at is null then private.task_start(r.due_date, r.start_time)
                  else private.reminder_deadline(r.due_date, r.end_time) end;
    who := case r.target when 'assignee' then r.assigned_to else r.person_id end;
    why := case
      when r.status = 'done' then 'Task was already done'
      when who is null then 'Task had no assignee'
      when r.remind_at is null and r.direction = 'before' and pivot < now()
        then case r.anchor when 'start' then 'The start time had already passed' else 'Deadline had already passed' end
      when r.auto and fire < r.created_at then 'Task was added too close to the time for this reminder'
      when fire < now() - interval '3 hours' then 'Missed (more than 3 hours late)'
    end;
    if why is not null then
      update public.task_reminders set skipped = why where id = r.id;
      continue;
    end if;
    what := case
      when r.anchor = 'start' and r.remind_at is null then
        case when pivot > now() then 'starts at ' || to_char(pivot at time zone 'Asia/Kolkata', 'HH12:MI AM') || ' (' || private.human_until(pivot) || ')'
             else 'started at ' || to_char(pivot at time zone 'Asia/Kolkata', 'HH12:MI AM') || ' (' || private.human_rel(pivot) || ')' end
      when pivot > now() then 'is due ' || private.reminder_due_text(r.due_date, r.start_time, r.end_time) || ' (' || private.human_until(pivot) || ')'
      else 'was due ' || private.reminder_due_text(r.due_date, r.start_time, r.end_time) || ' (' || private.human_rel(pivot) || ')'
    end;
    perform private.notify(array[who], r.task_id, null, 'reminder',
      'Reminder: "' || r.title || '" ' || what || '. Status: ' || private.status_label(r.status::text));
    if exists (select 1 from public.profiles where id = who and is_active) then
      insert into public.push_outbox (user_id, task_id, title, body, url, tag)
      values (who, r.task_id,
        '⏰ TM-' || r.task_no || ' · ' || left(r.title, 80),
        initcap(left(what, 1)) || substr(what, 2) || ' · ' || private.status_label(r.status::text),
        '/tasks?task=' || r.task_id,
        'reminder-' || r.id);
    end if;
    update public.task_reminders set sent_at = now() where id = r.id;
    sent := sent + 1;
  end loop;
  if sent > 0 then perform private.push_kick(); end if;
  return sent;
end $$;

-- ===== supabase/migrations/20261002100000_reels.sql =====
-- =====================================================================
-- 2.0 — Task kinds + Reels.
--   tasks.kind: 'task' (normal) | 'reel' (video edit for the reel editors) | 'meeting' (2.1).
--   task_reels: one row per reel task (made automatically): caption, Instagram / YouTube links,
--     posted time, expected views, expected edit time.
--   reel_views: view counts per platform over time (typed in by hand now; fetched automatically later).
--     "Views at 24 h" = the count recorded closest to 24 h after posting (between 18 h and 48 h).
--   task_time_entries: edit-time blocks from the Start / Pause / Stop timer (task_timer RPC).
--     Start → In Progress; Stop = editing finished → Done. One running timer per person;
--     starting another task pauses the first. Running timers pause at 23:59 IST.
-- =====================================================================

alter table public.tasks
  add column kind text not null default 'task' check (kind in ('task', 'reel', 'meeting'));

create table public.task_reels (
  task_id uuid primary key references public.tasks(id) on delete cascade,
  caption text,
  instagram_url text,
  youtube_url text,
  posted_at timestamptz,
  expected_views int check (expected_views >= 0),
  expected_minutes int check (expected_minutes between 1 and 10080),
  updated_at timestamptz not null default now()
);
alter table public.task_reels enable row level security;

create table public.reel_views (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'youtube')),
  views int not null check (views >= 0),
  counted_at timestamptz not null default now(),
  source text not null default 'manual' check (source in ('manual', 'auto')),
  recorded_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index reel_views_task on public.reel_views (task_id, platform, counted_at);
alter table public.reel_views enable row level security;

create table public.task_time_entries (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  manual boolean not null default false,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create index task_time_entries_task on public.task_time_entries (task_id);
create unique index task_time_one_running on public.task_time_entries (user_id) where ended_at is null;
alter table public.task_time_entries enable row level security;

-- ---------------------------------------------------------------- policies
create policy "reels read" on public.task_reels for select to authenticated
  using ((select private.can_see_task(task_id)));
create policy "reels update" on public.task_reels for update to authenticated
  using ((select private.can_see_task(task_id))) with check ((select private.can_see_task(task_id)));

create policy "views read" on public.reel_views for select to authenticated
  using ((select private.can_see_task(task_id)));
create policy "views add" on public.reel_views for insert to authenticated
  with check (source = 'manual' and recorded_by = (select auth.uid()) and (select private.can_see_task(task_id)));
create policy "views delete" on public.reel_views for delete to authenticated
  using (recorded_by = (select auth.uid()) or (select private.is_admin()));

create policy "time read" on public.task_time_entries for select to authenticated
  using ((select private.can_see_task(task_id)));
-- Time added by hand (e.g. after forgetting the timer): own, finished blocks only.
create policy "time add" on public.task_time_entries for insert to authenticated
  with check (user_id = (select auth.uid()) and manual and ended_at is not null and (select private.can_see_task(task_id)));
create policy "time delete" on public.task_time_entries for delete to authenticated
  using (ended_at is not null and (user_id = (select auth.uid()) or (select private.is_admin())));

grant select, update on public.task_reels to authenticated;
grant select, insert, delete on public.reel_views to authenticated;
grant select, insert, delete on public.task_time_entries to authenticated;

-- ---------------------------------------------------------------- triggers
/** Every reel task gets its details row. */
create or replace function private.tasks_reel_row() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'reel' then
    insert into public.task_reels (task_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger tasks_reel_row after insert or update of kind on public.tasks
  for each row execute function private.tasks_reel_row();

/** Expected views / edit time are set by whoever gave the task (or an admin); links, caption and posted time by anyone on it. */
create or replace function private.task_reels_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); t record;
begin
  new.task_id := old.task_id;
  if me is not null and not private.is_admin()
     and row(new.expected_views, new.expected_minutes) is distinct from row(old.expected_views, old.expected_minutes) then
    select created_by, assigned_by into t from public.tasks where id = old.task_id;
    if me not in (t.created_by, t.assigned_by) then
      raise exception 'Only the person who gave this reel (or an admin) can change the expected views or edit time';
    end if;
  end if;
  new.caption := nullif(btrim(new.caption), '');
  new.instagram_url := nullif(btrim(new.instagram_url), '');
  new.youtube_url := nullif(btrim(new.youtube_url), '');
  -- Adding the first link counts as "posted now" unless a time was given.
  if new.posted_at is null and old.posted_at is null and (new.instagram_url is not null or new.youtube_url is not null) then
    new.posted_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger task_reels_guard before update on public.task_reels
  for each row execute function private.task_reels_guard();

/** A count can't be dated in the future; manual rows are stamped with who typed them. */
create or replace function private.reel_views_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.counted_at > now() + interval '5 minutes' then raise exception 'The count can''t be in the future'; end if;
  return new;
end $$;
create trigger reel_views_before before insert on public.reel_views
  for each row execute function private.reel_views_before();

create or replace function private.time_entries_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.manual and new.ended_at - new.started_at > interval '24 hours' then
    raise exception 'Add at most 24 hours at a time';
  end if;
  if new.manual and new.ended_at > now() + interval '5 minutes' then raise exception 'Time can''t be in the future'; end if;
  return new;
end $$;
create trigger time_entries_before before insert on public.task_time_entries
  for each row execute function private.time_entries_before();

/** Done or handed to someone else → its running timer stops. */
create or replace function private.tasks_stop_timers() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.status = 'done' and old.status <> 'done') or new.assigned_to is distinct from old.assigned_to then
    update public.task_time_entries set ended_at = now() where task_id = new.id and ended_at is null;
  end if;
  return new;
end $$;
create trigger tasks_stop_timers after update of status, assigned_to on public.tasks
  for each row execute function private.tasks_stop_timers();

-- ---------------------------------------------------------------- timer
/** Start / Pause / Stop the edit timer. Start: assignee only. Pause / Stop: assignee or admin. */
create or replace function public.task_timer(p_task uuid, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  t record;
  closed int;
begin
  if me is null then raise exception 'Please sign in again'; end if;
  if p_action not in ('start', 'pause', 'stop') then raise exception 'Unknown timer action'; end if;
  select id, assigned_to, status, recurring_id into t from public.tasks where id = p_task;
  if not found or not private.can_see_task(p_task) then raise exception 'Task not found'; end if;

  if p_action = 'start' then
    if t.assigned_to is distinct from me then raise exception 'Only the person this task is assigned to can start the timer'; end if;
    -- One running timer per person: starting here pauses the other one.
    with x as (
      update public.task_time_entries set ended_at = now() where user_id = me and ended_at is null and task_id <> p_task returning task_id
    )
    insert into public.task_activity (task_id, actor_id, action, new_value) select x.task_id, me, 'timer', 'paused' from x;
    if not exists (select 1 from public.task_time_entries where user_id = me and task_id = p_task and ended_at is null) then
      insert into public.task_time_entries (task_id, user_id) values (p_task, me);
      insert into public.task_activity (task_id, actor_id, action, new_value) values (p_task, me, 'timer', 'started');
    end if;
    if t.status <> 'in_progress' then update public.tasks set status = 'in_progress' where id = p_task; end if;
    return;
  end if;

  if me is distinct from t.assigned_to and not private.is_admin() then
    raise exception 'Only the person this task is assigned to (or an admin) can pause or stop the timer';
  end if;
  update public.task_time_entries set ended_at = now() where task_id = p_task and ended_at is null;
  get diagnostics closed = row_count;
  if p_action = 'pause' then
    if closed > 0 then
      insert into public.task_activity (task_id, actor_id, action, new_value) values (p_task, me, 'timer', 'paused');
    end if;
  else
    insert into public.task_activity (task_id, actor_id, action, new_value) values (p_task, me, 'timer', 'stopped');
    if t.status <> 'done' then update public.tasks set status = 'done' where id = p_task; end if;
  end if;
end $$;
revoke execute on function public.task_timer(uuid, text) from public, anon;
grant execute on function public.task_timer(uuid, text) to authenticated;

/** Nightly: timers still running at 23:59 IST are paused (forgotten timers don't count overnight). */
create or replace function private.pause_running_timers() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with x as (
    update public.task_time_entries set ended_at = now() where ended_at is null returning task_id, user_id
  )
  insert into public.task_activity (task_id, actor_id, action, new_value)
  select task_id, user_id, 'timer', 'auto_paused' from x;
  get diagnostics n = row_count;
  return n;
end $$;
select cron.schedule('pause-running-timers', '29 18 * * *', $$select private.pause_running_timers()$$);

-- ---------------------------------------------------------------- report
/** Views at 24 h for one reel and platform: the count closest to 24 h after posting, within 18–48 h. */
create or replace function private.reel_views_24h(p_task uuid, p_platform text, p_posted timestamptz) returns int
language sql stable security definer set search_path = '' as $$
  select v.views from public.reel_views v
   where v.task_id = p_task and v.platform = p_platform and p_posted is not null
     and v.counted_at between p_posted + interval '18 hours' and p_posted + interval '48 hours'
   order by abs(extract(epoch from v.counted_at - (p_posted + interval '24 hours'))), v.counted_at desc
   limit 1
$$;

/** Reels report (admin): one row per reel task due in the range. Minutes include a running timer up to now. */
create or replace function public.report_reels(p_from date, p_to date, p_team uuid default null)
returns table (
  task_id uuid, task_no int, title text, editor_id uuid, editor_name text, team_name text,
  status text, due_date date, completed_at timestamptz, posted_at timestamptz,
  instagram_url text, youtube_url text,
  expected_views int, views_24h int, latest_views int, latest_at timestamptz,
  expected_minutes int, actual_minutes int, timer_running boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Only admins can see reports'; end if;
  return query
  select t.id, t.task_no::int, t.title, t.assigned_to, p.full_name, tm.name,
    t.status::text, t.due_date, t.completed_at, r.posted_at, r.instagram_url, r.youtube_url,
    r.expected_views,
    case when ig.v is null and yt.v is null then null else (coalesce(ig.v, 0) + coalesce(yt.v, 0))::int end,
    lv.total::int, lv.at,
    r.expected_minutes,
    coalesce(te.mins, 0)::int, coalesce(te.running, false)
  from public.tasks t
  join public.task_reels r on r.task_id = t.id
  left join public.profiles p on p.id = t.assigned_to
  left join public.teams tm on tm.id = p.team_id
  cross join lateral (select private.reel_views_24h(t.id, 'instagram', r.posted_at) as v) ig
  cross join lateral (select private.reel_views_24h(t.id, 'youtube', r.posted_at) as v) yt
  left join lateral (
    select sum(x.views) as total, max(x.counted_at) as at from (
      select distinct on (v.platform) v.views, v.counted_at from public.reel_views v
       where v.task_id = t.id order by v.platform, v.counted_at desc
    ) x
  ) lv on true
  left join lateral (
    select round(sum(extract(epoch from coalesce(e.ended_at, now()) - e.started_at)) / 60) as mins,
           bool_or(e.ended_at is null) as running
      from public.task_time_entries e where e.task_id = t.id
  ) te on true
  where t.kind = 'reel' and t.due_date between p_from and p_to
    and (p_team is null or p.team_id = p_team)
  order by t.due_date, t.task_no;
end $$;
revoke execute on function public.report_reels(date, date, uuid) from public, anon;
grant execute on function public.report_reels(date, date, uuid) to authenticated;

-- ===== supabase/migrations/20261002110000_reels_editor_targets.sql =====
-- 2.0 (owner feedback, 2 Oct):
--   * Reels have no reminders (no automatic ones, none can be added).
--   * Expected views / edit time are set by the editor (the assignee), not in Add Task.
--     Editor, the person who gave it, or an admin may set them; once the reel is Done only an admin can change them.
--   * New "upload date" (the day the reel should go up), set by whoever gives the reel (or an admin).

alter table public.task_reels add column if not exists upload_date date;

create or replace function private.task_reels_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); t record;
begin
  new.task_id := old.task_id;
  if me is not null and not private.is_admin() then
    select created_by, assigned_by, assigned_to, status into t from public.tasks where id = old.task_id;
    if row(new.expected_views, new.expected_minutes) is distinct from row(old.expected_views, old.expected_minutes) then
      if me not in (coalesce(t.assigned_to, t.created_by), t.created_by, t.assigned_by) then
        raise exception 'Only the editor (or whoever gave the reel) can set the expected views and edit time';
      end if;
      if t.status = 'done' then
        raise exception 'This reel is done, so only an admin can change the expected views or edit time';
      end if;
    end if;
    if new.upload_date is distinct from old.upload_date and me not in (t.created_by, t.assigned_by) then
      raise exception 'Only the person who gave this reel (or an admin) can change the upload date';
    end if;
  end if;
  new.caption := nullif(btrim(new.caption), '');
  new.instagram_url := nullif(btrim(new.instagram_url), '');
  new.youtube_url := nullif(btrim(new.youtube_url), '');
  -- Adding the first link counts as "posted now" unless a time was given.
  if new.posted_at is null and old.posted_at is null and (new.instagram_url is not null or new.youtube_url is not null) then
    new.posted_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Reels: automatic reminders (inserted by tasks_auto_reminders) are quietly skipped; adding one by hand is refused.
create or replace function private.task_reminders_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  t record;
begin
  select id, recurring_id, kind, due_date, assigned_by, assigned_to, created_by into t from public.tasks where id = new.task_id;
  if not found then raise exception 'Task not found'; end if;
  if t.recurring_id is not null then raise exception 'Recurring tasks don''t have reminders'; end if;
  if t.kind = 'reel' then
    if pg_trigger_depth() > 1 then return null; end if;
    raise exception 'Reels don''t have reminders';
  end if;
  if new.minutes_before is not null and t.due_date is null then raise exception 'This task has no due date, so pick an exact time'; end if;
  if new.remind_at is not null then new.direction := 'before'; new.anchor := 'end'; end if;
  new.sent_at := null; new.skipped := null;
  if me is not null and pg_trigger_depth() = 1 then
    new.auto := false;
    new.created_by := me;
    if not private.can_see_task(new.task_id) then raise exception 'You can''t see this task'; end if;
    if not (private.is_admin() or me in (t.assigned_by, t.created_by)
            or (new.target = 'person' and new.person_id = me)
            or (new.target = 'assignee' and t.assigned_to = me)) then
      raise exception 'You can set reminders for yourself only';
    end if;
  end if;
  if new.target = 'assignee' then new.person_id := null; end if;
  if new.target = 'person' and not exists (select 1 from public.profiles where id = new.person_id and is_active) then
    raise exception 'Reminders can only go to active users';
  end if;
  return new;
end $$;

-- (The Reels report reads upload_date from task_reels directly, so report_reels stays as it is.)

-- Reels created before this change: their open reminders are marked skipped.
update public.task_reminders rm set skipped = 'Reels don''t have reminders'
  from public.tasks t where t.id = rm.task_id and t.kind = 'reel' and rm.sent_at is null and rm.skipped is null;

-- ===== supabase/migrations/20261002120000_reel_single_views.sql =====
-- 2.0 (owner feedback, 2 Oct): one view count per reel instead of a list of counts.
--   task_reels.actual_views (+ when / who). Anyone on the reel can set it; the Reels report uses it as "actual views".
--   reel_views stays (unused for now) for automatic counts later (2.3).

alter table public.task_reels
  add column if not exists actual_views int check (actual_views >= 0),
  add column if not exists views_counted_at timestamptz,
  add column if not exists views_counted_by uuid references public.profiles(id) on delete set null;

-- Keep any counts already typed in: the newest per platform, added up.
update public.task_reels r set actual_views = x.total, views_counted_at = x.at
  from (
    select task_id, sum(views)::int as total, max(counted_at) as at from (
      select distinct on (task_id, platform) task_id, views, counted_at from public.reel_views order by task_id, platform, counted_at desc
    ) l group by task_id
  ) x
 where x.task_id = r.task_id and r.actual_views is null;

create or replace function private.task_reels_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); t record;
begin
  new.task_id := old.task_id;
  if me is not null and not private.is_admin() then
    select created_by, assigned_by, assigned_to, status into t from public.tasks where id = old.task_id;
    if row(new.expected_views, new.expected_minutes) is distinct from row(old.expected_views, old.expected_minutes) then
      if me not in (coalesce(t.assigned_to, t.created_by), t.created_by, t.assigned_by) then
        raise exception 'Only the editor (or whoever gave the reel) can set the expected views and edit time';
      end if;
      if t.status = 'done' then
        raise exception 'This reel is done, so only an admin can change the expected views or edit time';
      end if;
    end if;
    if new.upload_date is distinct from old.upload_date and me not in (t.created_by, t.assigned_by) then
      raise exception 'Only the person who gave this reel (or an admin) can change the upload date';
    end if;
  end if;
  if new.actual_views is distinct from old.actual_views then
    new.views_counted_at := case when new.actual_views is null then null else now() end;
    new.views_counted_by := case when new.actual_views is null then null else me end;
  else
    new.views_counted_at := old.views_counted_at;
    new.views_counted_by := old.views_counted_by;
  end if;
  new.caption := nullif(btrim(new.caption), '');
  new.instagram_url := nullif(btrim(new.instagram_url), '');
  new.youtube_url := nullif(btrim(new.youtube_url), '');
  if new.posted_at is null and old.posted_at is null and (new.instagram_url is not null or new.youtube_url is not null) then
    new.posted_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Report: views_24h / latest_views now both = the one count (same columns, so the app keeps working).
create or replace function public.report_reels(p_from date, p_to date, p_team uuid default null)
returns table (
  task_id uuid, task_no int, title text, editor_id uuid, editor_name text, team_name text,
  status text, due_date date, completed_at timestamptz, posted_at timestamptz,
  instagram_url text, youtube_url text,
  expected_views int, views_24h int, latest_views int, latest_at timestamptz,
  expected_minutes int, actual_minutes int, timer_running boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Only admins can see reports'; end if;
  return query
  select t.id, t.task_no::int, t.title, t.assigned_to, p.full_name, tm.name,
    t.status::text, t.due_date, t.completed_at, r.posted_at, r.instagram_url, r.youtube_url,
    r.expected_views, r.actual_views, r.actual_views, r.views_counted_at,
    r.expected_minutes,
    coalesce(te.mins, 0)::int, coalesce(te.running, false)
  from public.tasks t
  join public.task_reels r on r.task_id = t.id
  left join public.profiles p on p.id = t.assigned_to
  left join public.teams tm on tm.id = p.team_id
  left join lateral (
    select round(sum(extract(epoch from coalesce(e.ended_at, now()) - e.started_at)) / 60) as mins,
           bool_or(e.ended_at is null) as running
      from public.task_time_entries e where e.task_id = t.id
  ) te on true
  where t.kind = 'reel' and t.due_date between p_from and p_to
    and (p_team is null or p.team_id = p_team)
  order by t.due_date, t.task_no;
end $$;

-- ===== supabase/migrations/20261002130000_reel_start_needs_targets.sql =====
-- 2.0: a reel's timer can only start once the editor has set the expected views and edit time.

create or replace function public.task_timer(p_task uuid, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  t record;
  closed int;
begin
  if me is null then raise exception 'Please sign in again'; end if;
  if p_action not in ('start', 'pause', 'stop') then raise exception 'Unknown timer action'; end if;
  select id, assigned_to, status, recurring_id, kind into t from public.tasks where id = p_task;
  if not found or not private.can_see_task(p_task) then raise exception 'Task not found'; end if;

  if p_action = 'start' then
    if t.assigned_to is distinct from me then raise exception 'Only the person this task is assigned to can start the timer'; end if;
    if t.kind = 'reel' and exists (select 1 from public.task_reels r where r.task_id = p_task
                                   and (r.expected_views is null or r.expected_minutes is null)) then
      raise exception 'Set the expected views and edit time (🎬 Reel tab) before you start';
    end if;
    -- One running timer per person: starting here pauses the other one.
    with x as (
      update public.task_time_entries set ended_at = now() where user_id = me and ended_at is null and task_id <> p_task returning task_id
    )
    insert into public.task_activity (task_id, actor_id, action, new_value) select x.task_id, me, 'timer', 'paused' from x;
    if not exists (select 1 from public.task_time_entries where user_id = me and task_id = p_task and ended_at is null) then
      insert into public.task_time_entries (task_id, user_id) values (p_task, me);
      insert into public.task_activity (task_id, actor_id, action, new_value) values (p_task, me, 'timer', 'started');
    end if;
    if t.status <> 'in_progress' then update public.tasks set status = 'in_progress' where id = p_task; end if;
    return;
  end if;

  if me is distinct from t.assigned_to and not private.is_admin() then
    raise exception 'Only the person this task is assigned to (or an admin) can pause or stop the timer';
  end if;
  update public.task_time_entries set ended_at = now() where task_id = p_task and ended_at is null;
  get diagnostics closed = row_count;
  if p_action = 'pause' then
    if closed > 0 then
      insert into public.task_activity (task_id, actor_id, action, new_value) values (p_task, me, 'timer', 'paused');
    end if;
  else
    insert into public.task_activity (task_id, actor_id, action, new_value) values (p_task, me, 'timer', 'stopped');
    if t.status <> 'done' then update public.tasks set status = 'done' where id = p_task; end if;
  end if;
end $$;

-- ===== supabase/migrations/20261002140000_reel_targets_editor_only.sql =====
-- 2.0 (owner, 2 Oct): the expected views and edit time are the editor's own estimate.
--   * Only the editor (the reel's assignee) sets them — not the assigner, not an admin.
--   * No condition before Start (the earlier "set them before Start" rule is removed).
--   * The editor can set or change them any time (no lock after Done / after the actual views).

create or replace function private.task_reels_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); t record;
begin
  new.task_id := old.task_id;
  if me is not null then
    select created_by, assigned_by, assigned_to, status into t from public.tasks where id = old.task_id;
    -- Expected views / edit time: the editor's own estimate, so only the editor (assignee) sets them.
    if new.expected_minutes is distinct from old.expected_minutes then
      if me is distinct from t.assigned_to then raise exception 'Only the editor of this reel can set the expected edit time'; end if;
    end if;
    if new.expected_views is distinct from old.expected_views then
      if me is distinct from t.assigned_to then raise exception 'Only the editor of this reel can set the expected views'; end if;
    end if;
    if new.upload_date is distinct from old.upload_date and not private.is_admin() and me not in (t.created_by, t.assigned_by) then
      raise exception 'Only the person who gave this reel (or an admin) can change the upload date';
    end if;
  end if;
  if new.actual_views is distinct from old.actual_views then
    new.views_counted_at := case when new.actual_views is null then null else now() end;
    new.views_counted_by := case when new.actual_views is null then null else me end;
  else
    new.views_counted_at := old.views_counted_at;
    new.views_counted_by := old.views_counted_by;
  end if;
  new.caption := nullif(btrim(new.caption), '');
  new.instagram_url := nullif(btrim(new.instagram_url), '');
  new.youtube_url := nullif(btrim(new.youtube_url), '');
  if new.posted_at is null and old.posted_at is null and (new.instagram_url is not null or new.youtube_url is not null) then
    new.posted_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.task_timer(p_task uuid, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  t record;
  closed int;
begin
  if me is null then raise exception 'Please sign in again'; end if;
  if p_action not in ('start', 'pause', 'stop') then raise exception 'Unknown timer action'; end if;
  select id, assigned_to, status, recurring_id into t from public.tasks where id = p_task;
  if not found or not private.can_see_task(p_task) then raise exception 'Task not found'; end if;

  if p_action = 'start' then
    if t.assigned_to is distinct from me then raise exception 'Only the person this task is assigned to can start the timer'; end if;
    -- One running timer per person: starting here pauses the other one.
    with x as (
      update public.task_time_entries set ended_at = now() where user_id = me and ended_at is null and task_id <> p_task returning task_id
    )
    insert into public.task_activity (task_id, actor_id, action, new_value) select x.task_id, me, 'timer', 'paused' from x;
    if not exists (select 1 from public.task_time_entries where user_id = me and task_id = p_task and ended_at is null) then
      insert into public.task_time_entries (task_id, user_id) values (p_task, me);
      insert into public.task_activity (task_id, actor_id, action, new_value) values (p_task, me, 'timer', 'started');
    end if;
    if t.status <> 'in_progress' then update public.tasks set status = 'in_progress' where id = p_task; end if;
    return;
  end if;

  if me is distinct from t.assigned_to and not private.is_admin() then
    raise exception 'Only the person this task is assigned to (or an admin) can pause or stop the timer';
  end if;
  update public.task_time_entries set ended_at = now() where task_id = p_task and ended_at is null;
  get diagnostics closed = row_count;
  if p_action = 'pause' then
    if closed > 0 then
      insert into public.task_activity (task_id, actor_id, action, new_value) values (p_task, me, 'timer', 'paused');
    end if;
  else
    insert into public.task_activity (task_id, actor_id, action, new_value) values (p_task, me, 'timer', 'stopped');
    if t.status <> 'done' then update public.tasks set status = 'done' where id = p_task; end if;
  end if;
end $$;

-- ===== supabase/migrations/20261002150000_reel_stages.sql =====
-- 2.0 — Reel stages (owner, 2 Oct): Scripting → Editing → Review → Posted.
--   * The stage is separate from the status; the reel is marked Done by hand (status), like any task.
--   * Scripting: the script writer writes it, then reassigns the reel to the editor (and moves it to Editing).
--   * Timer Start → stage Editing (from Scripting). Timer "Editing done" (stop) → stage Review; no longer marks Done.
--   * Review: changes wanted → the manager reassigns it back (and moves it back to Editing).
--   * Saving the first post link (posted_at set) → stage Posted.
--   * Anyone on the reel (or an admin) can change the stage by hand. Stage changes go to the activity log.
--   * Upload (scheduled posting) date gets an optional time.

alter table public.task_reels
  add column if not exists stage text not null default 'scripting' check (stage in ('scripting', 'editing', 'review', 'posted')),
  add column if not exists upload_time time;

-- Existing reels: put them where they are now.
update public.task_reels r set stage = case
    when r.posted_at is not null then 'posted'
    when exists (select 1 from public.task_time_entries e where e.task_id = r.task_id) then 'editing'
    else 'scripting' end
 where r.stage = 'scripting';

create or replace function private.task_reels_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); t record;
begin
  new.task_id := old.task_id;
  if me is not null then
    select created_by, assigned_by, assigned_to, status into t from public.tasks where id = old.task_id;
    if new.expected_minutes is distinct from old.expected_minutes and me is distinct from t.assigned_to then
      raise exception 'Only the editor of this reel can set the expected edit time';
    end if;
    if new.expected_views is distinct from old.expected_views and me is distinct from t.assigned_to then
      raise exception 'Only the editor of this reel can set the expected views';
    end if;
    if row(new.upload_date, new.upload_time) is distinct from row(old.upload_date, old.upload_time)
       and not private.is_admin() and me not in (t.created_by, t.assigned_by) then
      raise exception 'Only the person who gave this reel (or an admin) can change the upload date';
    end if;
  end if;
  if new.upload_date is null then new.upload_time := null; end if;
  if new.actual_views is distinct from old.actual_views then
    new.views_counted_at := case when new.actual_views is null then null else now() end;
    new.views_counted_by := case when new.actual_views is null then null else me end;
  else
    new.views_counted_at := old.views_counted_at;
    new.views_counted_by := old.views_counted_by;
  end if;
  new.caption := nullif(btrim(new.caption), '');
  new.instagram_url := nullif(btrim(new.instagram_url), '');
  new.youtube_url := nullif(btrim(new.youtube_url), '');
  if new.posted_at is null and old.posted_at is null and (new.instagram_url is not null or new.youtube_url is not null) then
    new.posted_at := now();
  end if;
  -- Posting moves the reel to Posted (unless the stage was changed in the same save).
  if new.posted_at is not null and old.posted_at is null and new.stage is not distinct from old.stage then
    new.stage := 'posted';
  end if;
  new.updated_at := now();
  return new;
end $$;

/** Stage changes → activity log. */
create or replace function private.task_reels_log_stage() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.stage is distinct from old.stage then
    insert into public.task_activity (task_id, actor_id, action, old_value, new_value)
    values (new.task_id, (select auth.uid()), 'stage', old.stage, new.stage);
  end if;
  return new;
end $$;
create trigger task_reels_log_stage after update of stage on public.task_reels
  for each row execute function private.task_reels_log_stage();

/** Timer: Start → In Progress (+ stage Editing from Scripting). Stop = editing done → stage Review (status unchanged). */
create or replace function public.task_timer(p_task uuid, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  t record;
  closed int;
begin
  if me is null then raise exception 'Please sign in again'; end if;
  if p_action not in ('start', 'pause', 'stop') then raise exception 'Unknown timer action'; end if;
  select id, assigned_to, status, recurring_id, kind into t from public.tasks where id = p_task;
  if not found or not private.can_see_task(p_task) then raise exception 'Task not found'; end if;

  if p_action = 'start' then
    if t.assigned_to is distinct from me then raise exception 'Only the person this task is assigned to can start the timer'; end if;
    with x as (
      update public.task_time_entries set ended_at = now() where user_id = me and ended_at is null and task_id <> p_task returning task_id
    )
    insert into public.task_activity (task_id, actor_id, action, new_value) select x.task_id, me, 'timer', 'paused' from x;
    if not exists (select 1 from public.task_time_entries where user_id = me and task_id = p_task and ended_at is null) then
      insert into public.task_time_entries (task_id, user_id) values (p_task, me);
      insert into public.task_activity (task_id, actor_id, action, new_value) values (p_task, me, 'timer', 'started');
    end if;
    if t.status <> 'in_progress' then update public.tasks set status = 'in_progress' where id = p_task; end if;
    if t.kind = 'reel' then
      update public.task_reels set stage = 'editing' where task_id = p_task and stage = 'scripting';
    end if;
    return;
  end if;

  if me is distinct from t.assigned_to and not private.is_admin() then
    raise exception 'Only the person this task is assigned to (or an admin) can pause or stop the timer';
  end if;
  update public.task_time_entries set ended_at = now() where task_id = p_task and ended_at is null;
  get diagnostics closed = row_count;
  if p_action = 'pause' then
    if closed > 0 then
      insert into public.task_activity (task_id, actor_id, action, new_value) values (p_task, me, 'timer', 'paused');
    end if;
  else
    insert into public.task_activity (task_id, actor_id, action, new_value) values (p_task, me, 'timer', 'stopped');
    if t.kind = 'reel' then
      update public.task_reels set stage = 'review' where task_id = p_task and stage in ('scripting', 'editing');
    elsif t.status <> 'done' then
      update public.tasks set status = 'done' where id = p_task;
    end if;
  end if;
end $$;

-- ===== supabase/migrations/20261002160000_revert_reel_stages.sql =====
-- 2.0: owner asked to revert reel stages (2 Oct). Back to: timer Stop = editing finished → Done;
-- no stage moves. The stage / upload_time columns stay in the table, unused.

create or replace function private.task_reels_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); t record;
begin
  new.task_id := old.task_id;
  if me is not null then
    select created_by, assigned_by, assigned_to, status into t from public.tasks where id = old.task_id;
    if new.expected_minutes is distinct from old.expected_minutes and me is distinct from t.assigned_to then
      raise exception 'Only the editor of this reel can set the expected edit time';
    end if;
    if new.expected_views is distinct from old.expected_views and me is distinct from t.assigned_to then
      raise exception 'Only the editor of this reel can set the expected views';
    end if;
    if new.upload_date is distinct from old.upload_date and not private.is_admin() and me not in (t.created_by, t.assigned_by) then
      raise exception 'Only the person who gave this reel (or an admin) can change the upload date';
    end if;
  end if;
  if new.actual_views is distinct from old.actual_views then
    new.views_counted_at := case when new.actual_views is null then null else now() end;
    new.views_counted_by := case when new.actual_views is null then null else me end;
  else
    new.views_counted_at := old.views_counted_at;
    new.views_counted_by := old.views_counted_by;
  end if;
  new.caption := nullif(btrim(new.caption), '');
  new.instagram_url := nullif(btrim(new.instagram_url), '');
  new.youtube_url := nullif(btrim(new.youtube_url), '');
  if new.posted_at is null and old.posted_at is null and (new.instagram_url is not null or new.youtube_url is not null) then
    new.posted_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Stage logging is off (the trigger stays but does nothing).
create or replace function private.task_reels_log_stage() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  return new;
end $$;

create or replace function public.task_timer(p_task uuid, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  t record;
  closed int;
begin
  if me is null then raise exception 'Please sign in again'; end if;
  if p_action not in ('start', 'pause', 'stop') then raise exception 'Unknown timer action'; end if;
  select id, assigned_to, status, recurring_id into t from public.tasks where id = p_task;
  if not found or not private.can_see_task(p_task) then raise exception 'Task not found'; end if;

  if p_action = 'start' then
    if t.assigned_to is distinct from me then raise exception 'Only the person this task is assigned to can start the timer'; end if;
    -- One running timer per person: starting here pauses the other one.
    with x as (
      update public.task_time_entries set ended_at = now() where user_id = me and ended_at is null and task_id <> p_task returning task_id
    )
    insert into public.task_activity (task_id, actor_id, action, new_value) select x.task_id, me, 'timer', 'paused' from x;
    if not exists (select 1 from public.task_time_entries where user_id = me and task_id = p_task and ended_at is null) then
      insert into public.task_time_entries (task_id, user_id) values (p_task, me);
      insert into public.task_activity (task_id, actor_id, action, new_value) values (p_task, me, 'timer', 'started');
    end if;
    if t.status <> 'in_progress' then update public.tasks set status = 'in_progress' where id = p_task; end if;
    return;
  end if;

  if me is distinct from t.assigned_to and not private.is_admin() then
    raise exception 'Only the person this task is assigned to (or an admin) can pause or stop the timer';
  end if;
  update public.task_time_entries set ended_at = now() where task_id = p_task and ended_at is null;
  get diagnostics closed = row_count;
  if p_action = 'pause' then
    if closed > 0 then
      insert into public.task_activity (task_id, actor_id, action, new_value) values (p_task, me, 'timer', 'paused');
    end if;
  else
    insert into public.task_activity (task_id, actor_id, action, new_value) values (p_task, me, 'timer', 'stopped');
    if t.status <> 'done' then update public.tasks set status = 'done' where id = p_task; end if;
  end if;
end $$;

-- ===== supabase/migrations/20261002170000_no_auto_reminders.sql =====
-- 2.0 (owner, 2 Oct): no automatic reminders. Reminders are added only by hand, when someone wants one.
-- Settings → Reminders is removed from the app. The rules table stays (unused); reminders already added stay as they are.

create or replace function private.tasks_auto_reminders() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  return new;
end $$;

-- ===== supabase/migrations/20261002180000_reel_drive_link.sql =====
-- 2.0: a Google Drive link on reels (the edited video / raw files). Not a post link, so it doesn't set posted_at.
alter table public.task_reels add column if not exists drive_url text;

-- ===== supabase/migrations/20261002190000_reel_sub_type.sql =====
-- 2.0: reel sub-type (Podcast Editing, Thumbnail Design, Shoot, …), picked when the reel is given. List lives in src/lib/reels.ts.
alter table public.task_reels add column if not exists sub_type text;

-- ===== supabase/migrations/20261002200000_whatsapp_assigned_comment_off.sql =====
-- 2.1 (owner, 2 Oct): no WhatsApp for "task assigned" and "comment" any more (phone notifications + bell cover them).
-- The triggers are disabled, not dropped. Undo:
--   alter table public.tasks enable trigger tasks_whatsapp;
--   alter table public.task_comments enable trigger task_comments_whatsapp;
alter table public.tasks disable trigger tasks_whatsapp;
alter table public.task_comments disable trigger task_comments_whatsapp;

-- Anything still waiting to go out is skipped.
update public.whatsapp_outbox set status = 'skipped', last_error = 'WhatsApp for new tasks/comments turned off'
 where kind in ('task_assigned', 'task_comment') and status in ('queued', 'sending');

-- ===== supabase/migrations/20261003100000_meetings.sql =====
-- =====================================================================
-- 2.2 — Meetings (tasks.kind = 'meeting').
--   * The organiser is the creator; the meeting is "assigned" to them (assigned_to = created_by).
--   * task_meetings: meeting link, notes, "remind everyone N minutes before" (+ when that went out).
--   * task_attendees: who's invited + their answer (pending / going / declined).
--     Attendees can see the meeting (they're added to tasks.participants) and answer for themselves.
--   * Invites → bell + phone notification (type 'meeting'); "can't make it" → bell to the organiser.
--   * tasks.meeting_id: action items (normal tasks) made from a meeting.
--   * Meetings are left out of Reports → Tasks and the day-end WhatsApp report, and don't get the
--     normal "assigned to you" notification.
-- =====================================================================

alter table public.tasks add column if not exists meeting_id uuid references public.tasks(id) on delete set null;
create index if not exists tasks_meeting_id on public.tasks (meeting_id) where meeting_id is not null;

create table public.task_meetings (
  task_id uuid primary key references public.tasks(id) on delete cascade,
  meeting_link text,
  notes text,
  notes_updated_at timestamptz,
  notes_updated_by uuid references public.profiles(id) on delete set null,
  remind_minutes int check (remind_minutes between 0 and 1440),
  reminded_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.task_meetings enable row level security;

create table public.task_attendees (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  response text not null default 'pending' check (response in ('pending', 'going', 'declined')),
  responded_at timestamptz,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index task_attendees_user on public.task_attendees (user_id);
alter table public.task_attendees enable row level security;

/** Organiser (creator / assignee) or an admin. */
create or replace function private.is_meeting_organiser(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin() or exists (
    select 1 from public.tasks t where t.id = p_task and (select auth.uid()) in (t.created_by, t.assigned_to)
  )
$$;

create policy "meeting read" on public.task_meetings for select to authenticated using ((select private.can_see_task(task_id)));
create policy "meeting update" on public.task_meetings for update to authenticated
  using ((select private.can_see_task(task_id))) with check ((select private.can_see_task(task_id)));
create policy "attendees read" on public.task_attendees for select to authenticated using ((select private.can_see_task(task_id)));
create policy "attendees add" on public.task_attendees for insert to authenticated with check ((select private.is_meeting_organiser(task_id)));
create policy "attendees remove" on public.task_attendees for delete to authenticated using ((select private.is_meeting_organiser(task_id)));
create policy "attendees answer" on public.task_attendees for update to authenticated
  using (user_id = (select auth.uid()) or (select private.is_meeting_organiser(task_id)))
  with check (user_id = (select auth.uid()) or (select private.is_meeting_organiser(task_id)));
grant select, update on public.task_meetings to authenticated;
grant select, insert, update, delete on public.task_attendees to authenticated;

-- ---------------------------------------------------------------- triggers
/** Every meeting gets its details row. */
create or replace function private.tasks_meeting_row() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'meeting' then
    insert into public.task_meetings (task_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger tasks_meeting_row after insert or update of kind on public.tasks
  for each row execute function private.tasks_meeting_row();

/** Notes stamp who/when; link trimmed. Moving the meeting re-arms its reminder (see tasks_meeting_moved). */
create or replace function private.task_meetings_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.task_id := old.task_id;
  new.meeting_link := nullif(btrim(new.meeting_link), '');
  if new.notes is distinct from old.notes then
    new.notes_updated_at := now(); new.notes_updated_by := (select auth.uid());
  end if;
  if new.remind_minutes is distinct from old.remind_minutes then new.reminded_at := null; end if;
  if (select auth.uid()) is not null and not private.is_meeting_organiser(old.task_id)
     and row(new.meeting_link, new.remind_minutes) is distinct from row(old.meeting_link, old.remind_minutes) then
    raise exception 'Only the organiser can change the meeting link or reminder';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger task_meetings_before before update on public.task_meetings
  for each row execute function private.task_meetings_before();

create or replace function private.tasks_meeting_moved() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'meeting' and row(new.due_date, new.start_time) is distinct from row(old.due_date, old.start_time) then
    update public.task_meetings set reminded_at = null where task_id = new.id;
  end if;
  return new;
end $$;
create trigger tasks_meeting_moved after update of due_date, start_time on public.tasks
  for each row execute function private.tasks_meeting_moved();

/** Attendees: only on meetings, active people, not the organiser; answers by the attendee themself. */
create or replace function private.task_attendees_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); t record;
begin
  select id, kind, created_by, assigned_to into t from public.tasks where id = new.task_id;
  if not found or t.kind <> 'meeting' then raise exception 'Attendees can only be added to meetings'; end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.profiles where id = new.user_id and is_active) then
      raise exception 'Only active users can be invited';
    end if;
    new.response := 'pending'; new.responded_at := null; new.added_by := me;
  else
    new.task_id := old.task_id; new.user_id := old.user_id; new.added_by := old.added_by;
    if new.response is distinct from old.response then
      if me is not null and me <> old.user_id and not private.is_admin() then
        raise exception 'Only the attendee can answer for themselves';
      end if;
      new.responded_at := now();
    end if;
  end if;
  return new;
end $$;
create trigger task_attendees_before before insert or update on public.task_attendees
  for each row execute function private.task_attendees_before();

/** Keep tasks.participants in step with the attendee list (meetings recompute it in tasks_before_write). */
create or replace function private.task_attendees_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare tid uuid := coalesce(new.task_id, old.task_id); who text; t record;
begin
  update public.tasks set participants = participants where id = tid;
  select id, title, created_by, assigned_to into t from public.tasks where id = tid;
  if tg_op = 'INSERT' then
    who := private.person_name(coalesce((select auth.uid()), t.created_by));
    perform private.notify(array[new.user_id], tid, coalesce((select auth.uid()), t.created_by), 'meeting',
      who || ' invited you to the meeting "' || t.title || '"');
  elsif tg_op = 'UPDATE' and new.response is distinct from old.response and new.response = 'declined' then
    perform private.notify(array[coalesce(t.assigned_to, t.created_by)], tid, new.user_id, 'meeting',
      private.person_name(new.user_id) || ' can''t make it to "' || t.title || '"');
  end if;
  return coalesce(new, old);
end $$;
create trigger task_attendees_sync after insert or update or delete on public.task_attendees
  for each row execute function private.task_attendees_sync();

-- Push for invites too (type 'meeting').
create or replace function private.notifications_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t record; push_title text;
begin
  if new.type not in ('assigned', 'comment', 'meeting') or new.task_id is null then return new; end if;
  if not exists (select 1 from public.push_subscriptions s where s.user_id = new.user_id) then return new; end if;
  select tk.id, tk.task_no, tk.title, tk.assigned_to into t from public.tasks tk where tk.id = new.task_id;
  if not found then return new; end if;
  if new.type = 'assigned' and t.assigned_to is distinct from new.user_id then return new; end if;
  push_title := case new.type when 'assigned' then '📋 New task · TM-' when 'meeting' then '📅 Meeting · TM-' else '💬 TM-' end
    || t.task_no || ' · ' || left(t.title, 70);
  insert into public.push_outbox (user_id, task_id, title, body, url, tag)
  values (new.user_id, t.id, push_title, left(new.message, 300), '/tasks?task=' || t.id,
          case new.type when 'comment' then 'comment-' || t.id when 'meeting' then 'meeting-' || t.id || '-' || new.id else 'assigned-' || t.id end);
  perform private.push_kick();
  return new;
end $$;

-- No "has assigned … to you" for meetings (the invites cover it).
create or replace function private.tasks_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := coalesce((select auth.uid()), case when tg_op = 'INSERT' then new.created_by end);
  who text;
  t text := '"' || new.title || '"';
  admins uuid[] := private.active_admins();
  by_assignee boolean;
  changes text[] := '{}';
begin
  if actor is null then return new; end if;
  if new.kind = 'meeting' then return new; end if;
  if tg_op = 'INSERT' and new.recurring_id is not null then return new; end if;
  who := private.person_name(actor);

  if tg_op = 'INSERT' then
    if new.assigned_to is null then
      perform private.notify(admins, new.id, actor, 'assigned', who || ' added ' || t || ' without an assignee');
      return new;
    end if;
    perform private.notify(array[new.assigned_to], new.id, actor, 'assigned', who || ' has assigned ' || t || ' to you');
    perform private.notify(array(select unnest(admins) except select new.assigned_to), new.id, actor, 'assigned',
      who || ' has assigned ' || t || ' to ' || private.person_name(new.assigned_to));
    return new;
  end if;

  by_assignee := coalesce(actor = old.assigned_to, false);

  if new.assigned_to is distinct from old.assigned_to then
    if new.assigned_to is null then return new; end if;
    perform private.notify(array[new.assigned_to], new.id, actor, 'reassigned', who || ' has assigned ' || t || ' to you');
    perform private.notify(
      array(select unnest(admins || case when by_assignee then array[old.assigned_by] else '{}'::uuid[] end)
            except select new.assigned_to),
      new.id, actor, 'reassigned',
      who || case when old.assigned_to is null then ' has assigned ' else ' has reassigned ' end || t || ' to ' || private.person_name(new.assigned_to));
    return new;
  end if;

  if not by_assignee then return new; end if;

  if new.status is distinct from old.status then
    perform private.notify(admins || new.assigned_by, new.id, actor, 'status',
      who || ' changed the status of ' || t || ' to ' || private.status_label(new.status::text));
  end if;

  if new.title is distinct from old.title then changes := changes || 'title'::text; end if;
  if new.description is distinct from old.description then changes := changes || 'description'::text; end if;
  if new.due_date is distinct from old.due_date then changes := changes || 'due date'::text; end if;
  if new.priority is distinct from old.priority then changes := changes || 'priority'::text; end if;
  if new.start_time is distinct from old.start_time or new.end_time is distinct from old.end_time then
    changes := changes || 'time'::text;
  end if;
  if array_length(changes, 1) > 0 then
    perform private.notify(admins || new.assigned_by, new.id, actor, 'updated',
      who || ' updated the ' || array_to_string(changes, ', ') || ' of ' || t);
  end if;
  return new;
end $$;

-- tasks_before_write: meetings — participants = organiser + attendees (recomputed, so removed attendees
-- lose access); only the organiser / an admin changes a meeting's status.
create or replace function private.tasks_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  admin boolean := private.is_admin();
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(actor, new.assigned_by);
    new.assigned_by := new.created_by;
    new.assigned_at := now();
    new.reassigned := false;
    new.seen_at := case when new.assigned_to = new.created_by then now() else null end;
  else
    new.created_by := old.created_by;
    new.kind := old.kind;

    if actor is not null and not admin then
      if actor <> old.created_by and (
           new.title is distinct from old.title
        or new.description is distinct from old.description
        or new.priority is distinct from old.priority) then
        raise exception 'Only the person who created this task (or an admin) can change its details';
      end if;
      if new.assigned_to is distinct from old.assigned_to
         and actor not in (old.created_by, coalesce(old.assigned_to, old.created_by), old.assigned_by) then
        raise exception 'Only the current assignee, the person who assigned it, or the creator can reassign this task';
      end if;
      if (new.due_date is distinct from old.due_date
          or new.start_time is distinct from old.start_time or new.end_time is distinct from old.end_time)
         and actor not in (coalesce(old.assigned_to, old.created_by), old.created_by) then
        raise exception 'Only the assignee or the creator can change the date or time of this task';
      end if;
      if old.kind = 'meeting' and new.status is distinct from old.status
         and actor not in (old.created_by, coalesce(old.assigned_to, old.created_by)) then
        raise exception 'Only the organiser can change the status of this meeting';
      end if;
      if new.seen_at is distinct from old.seen_at and new.assigned_to is not distinct from old.assigned_to
         and actor is distinct from old.assigned_to then
        new.seen_at := old.seen_at;
      end if;
    end if;

    if new.assigned_to is distinct from old.assigned_to then
      new.assigned_by := coalesce(actor, old.assigned_by);
      new.assigned_at := now();
      new.reassigned := old.assigned_to is not null;
      new.seen_at := case when new.assigned_to = actor then now() else null end;
      if new.status = 'done' then new.status := 'todo'; end if;
    else
      new.assigned_by := old.assigned_by;
      new.assigned_at := old.assigned_at;
      new.reassigned := old.reassigned;
    end if;

    if new.seen_at is null and actor is not null and actor = new.assigned_to
       and new.assigned_to is not distinct from old.assigned_to then
      new.seen_at := now();
    end if;

    if row(new.title, new.description, new.due_date, new.priority, new.status, new.assigned_to, new.start_time, new.end_time)
       is distinct from row(old.title, old.description, old.due_date, old.priority, old.status, old.assigned_to, old.start_time, old.end_time) then
      new.updated_at := now();
    else
      new.updated_at := old.updated_at;
    end if;
  end if;

  if new.kind = 'meeting' then
    new.participants := array(
      select distinct u from unnest(array[new.created_by, new.assigned_by, new.assigned_to]
        || coalesce(array(select a.user_id from public.task_attendees a where a.task_id = new.id), '{}'::uuid[])) u
      where u is not null
    );
  else
    new.participants := array(
      select distinct u from unnest(coalesce(old.participants, '{}') || array[new.created_by, new.assigned_by, new.assigned_to]) u
      where u is not null
    );
  end if;

  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;

  if tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to then
    if new.assigned_to is null then
      if actor is not null and not admin then
        raise exception 'Choose who to assign this task to';
      end if;
    elsif not exists (select 1 from public.profiles where id = new.assigned_to and is_active) then
      raise exception 'Tasks can only be assigned to active users';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- reminder for everyone
/** Meetings with "remind everyone N min before": organiser + attendees who haven't declined. Runs every minute. */
create or replace function private.send_meeting_reminders() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; start_at timestamptz; whos uuid[]; what text; n int := 0;
begin
  for r in
    select m.task_id, m.remind_minutes, t.task_no, t.title, t.due_date, t.start_time, t.status, t.created_by, t.assigned_to
      from public.task_meetings m join public.tasks t on t.id = m.task_id
     where m.remind_minutes is not null and m.reminded_at is null and t.kind = 'meeting'
       and t.status <> 'done' and t.start_time is not null and t.due_date is not null
       and private.task_start(t.due_date, t.start_time) - make_interval(mins => m.remind_minutes) <= now()
     for update of m skip locked
  loop
    start_at := private.task_start(r.due_date, r.start_time);
    update public.task_meetings set reminded_at = now() where task_id = r.task_id;
    if start_at < now() - interval '10 minutes' then continue; end if;   -- too late to be useful
    whos := array(
      select u from unnest(array[coalesce(r.assigned_to, r.created_by)]
        || array(select a.user_id from public.task_attendees a where a.task_id = r.task_id and a.response <> 'declined')) u
      where exists (select 1 from public.profiles p where p.id = u and p.is_active)
    );
    what := case when start_at > now()
      then 'starts at ' || to_char(start_at at time zone 'Asia/Kolkata', 'HH12:MI AM') || ' (' || private.human_until(start_at) || ')'
      else 'has started' end;
    insert into public.notifications (user_id, task_id, actor_id, type, message)
      select distinct u, r.task_id, null::uuid, 'reminder', 'Meeting "' || r.title || '" ' || what from unnest(whos) u;
    insert into public.push_outbox (user_id, task_id, title, body, url, tag)
      select distinct u, r.task_id, '📅 TM-' || r.task_no || ' · ' || left(r.title, 80),
             initcap(left(what, 1)) || substr(what, 2), '/tasks?task=' || r.task_id, 'meeting-reminder-' || r.task_id
        from unnest(whos) u;
    n := n + 1;
  end loop;
  if n > 0 then perform private.push_kick(); end if;
  return n;
end $$;
select cron.schedule('meeting-reminders', '* * * * *', $$select private.send_meeting_reminders()$$);

-- ---------------------------------------------------------------- reports without meetings
create or replace function public.report_by_person(p_from date, p_to date, p_team uuid default null)
returns table (
  user_id uuid, full_name text, team_name text, role_name text,
  assigned int, completed int, on_time int, late int, expired int, pending int
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Only admins can see reports'; end if;
  return query
  with t as (
    select x.assigned_to, x.status, x.completed_at, private.task_deadline(x.due_date, x.end_time) as deadline
    from public.tasks x
    where x.due_date between p_from and p_to and x.kind <> 'meeting'
  )
  select p.id, p.full_name, tm.name, r.name,
    count(t.*)::int,
    count(*) filter (where t.status = 'done')::int,
    count(*) filter (where t.status = 'done' and t.completed_at <= t.deadline)::int,
    count(*) filter (where t.status = 'done' and t.completed_at > t.deadline)::int,
    count(*) filter (where t.status <> 'done' and t.deadline < now())::int,
    count(*) filter (where t.status <> 'done' and t.deadline >= now())::int
  from public.profiles p
  left join public.teams tm on tm.id = p.team_id
  left join public.roles r on r.id = p.role_id
  left join t on t.assigned_to = p.id
  where (p.is_active or t.assigned_to is not null)
    and (p_team is null or p.team_id = p_team)
  group by p.id, p.full_name, tm.name, r.name
  order by p.full_name;
end $$;

create or replace function private.wa_daily_report(p_day date default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  d date := coalesce(p_day, private.today_ist());
  total int; done int; expired int; pending int; overdue_open int; n int := 0;
  a uuid;
begin
  select count(*),
         count(*) filter (where status = 'done'),
         count(*) filter (where status <> 'done' and private.task_deadline(due_date, end_time) < now()),
         count(*) filter (where status <> 'done' and private.task_deadline(due_date, end_time) >= now())
    into total, done, expired, pending
    from public.tasks where due_date = d and kind <> 'meeting';
  select count(*) into overdue_open from public.tasks where status <> 'done' and due_date < d and kind <> 'meeting';

  foreach a in array private.active_admins() loop
    perform private.wa_enqueue('daily_task_report', a, jsonb_build_object(
      'name', private.wa_text(private.person_name(a), 60),
      'date', to_char(d, 'DD-Mon-YYYY'),
      'total', total::text, 'done', done::text, 'expired', expired::text, 'pending', pending::text,
      'overdue', overdue_open::text,
      'link', private.setting('app_url') || '/reports'
    ));
    n := n + 1;
  end loop;
  return n;
end $$;

-- ===== supabase/migrations/20261003110000_meetings_auto_done.sql =====
-- 2.2 Meetings: a meeting is marked Done automatically at its end time (checked every minute),
-- so past meetings don't sit in To Do forever (the organiser can still change it by hand).

create or replace function private.finish_ended_meetings() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.tasks t set status = 'done'
   where t.kind = 'meeting' and t.status <> 'done' and t.due_date is not null
     and private.task_deadline(t.due_date, t.end_time) < now();
  get diagnostics n = row_count;
  return n;
end $$;

select cron.schedule('finish-ended-meetings', '* * * * *', $$select private.finish_ended_meetings()$$);

-- ===== supabase/migrations/20261003120000_report_meetings.sql =====
-- 2.3 Reports → Meetings (admin): one row per meeting in the dates, with its people and action items.
--   people  = organiser + attendees  [{id, name, team_id, team_name, organiser}]
--   actions = action items (tasks.meeting_id) [{assigned_to, status, expired}]
--   p_team  = only meetings with at least one person from that team.

create or replace function public.report_meetings(p_from date, p_to date, p_team uuid default null)
returns table (
  task_id uuid, task_no int, title text, due_date date, start_time time, end_time time, minutes int,
  status text, organiser_id uuid, organiser_name text, meeting_link text, has_notes boolean,
  people jsonb, actions jsonb
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Only admins can see reports'; end if;
  return query
  with m as (
    select t.*, coalesce(t.assigned_to, t.created_by) as org
      from public.tasks t
     where t.kind = 'meeting' and t.due_date between p_from and p_to
  ), ppl as (
    select m.id as mid, p.id, p.full_name, p.team_id, tm.name as team_name, (p.id = m.org) as organiser
      from m
      join public.profiles p on p.id = m.org or p.id in (select a.user_id from public.task_attendees a where a.task_id = m.id)
      left join public.teams tm on tm.id = p.team_id
  )
  select m.id, m.task_no::int, m.title, m.due_date, m.start_time, m.end_time,
    coalesce(round(extract(epoch from (m.end_time - m.start_time)) / 60), 0)::int,
    m.status::text, m.org, op.full_name, mm.meeting_link, coalesce(btrim(mm.notes), '') <> '',
    coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.full_name, 'team_id', x.team_id, 'team_name', x.team_name, 'organiser', x.organiser)
                order by x.organiser desc, x.full_name) from ppl x where x.mid = m.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('task_id', a.id, 'assigned_to', a.assigned_to, 'status', a.status,
                'expired', a.status <> 'done' and a.due_date is not null and private.task_deadline(a.due_date, a.end_time) < now()))
                from public.tasks a where a.meeting_id = m.id), '[]'::jsonb)
  from m
  left join public.profiles op on op.id = m.org
  left join public.task_meetings mm on mm.task_id = m.id
  where p_team is null or exists (select 1 from ppl x where x.mid = m.id and x.team_id = p_team)
  order by m.due_date, m.start_time nulls last, m.task_no;
end $$;

revoke all on function public.report_meetings(date, date, uuid) from public, anon;
grant execute on function public.report_meetings(date, date, uuid) to authenticated;

-- ===== supabase/migrations/20261005100000_whatsapp_pause.sql =====
-- WhatsApp pause switch (owner, 5 Oct): while private.app_settings 'whatsapp_paused' = 'on', nothing new is
-- queued for WhatsApp — the message is logged as Skipped ("WhatsApp paused") in WhatsApp Logs instead.
-- Bell + phone notifications are not affected.
-- Resume: update private.app_settings set value = 'off' where key = 'whatsapp_paused';

insert into private.app_settings (key, value) values ('whatsapp_paused', 'on')
  on conflict (key) do update set value = 'on';

create or replace function private.wa_enqueue(p_kind text, p_recipient uuid, p_params jsonb, p_task uuid default null, p_delay interval default '0'::interval)
returns void language plpgsql security definer set search_path = '' as $$
declare
  ph text;
  tmpl text := p_kind;
  paused boolean := coalesce(private.setting('whatsapp_paused'), 'off') = 'on';
begin
  select private.wa_phone(phone) into ph from public.profiles where id = p_recipient and is_active;
  if not found then return; end if;
  insert into public.whatsapp_outbox (kind, recipient_id, phone, template, params, task_id, send_after, status, last_error)
  values (p_kind, p_recipient, ph, tmpl, p_params, p_task, now() + p_delay,
          case when paused or ph is null then 'skipped' else 'queued' end,
          case when paused then 'WhatsApp paused' when ph is null then 'No valid phone number on the profile' end);
end $$;

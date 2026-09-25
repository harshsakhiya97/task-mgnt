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

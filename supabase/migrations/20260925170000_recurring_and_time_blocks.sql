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

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

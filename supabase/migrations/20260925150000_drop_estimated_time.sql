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

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

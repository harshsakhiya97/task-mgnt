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

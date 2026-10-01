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

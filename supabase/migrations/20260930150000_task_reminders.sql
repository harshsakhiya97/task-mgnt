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

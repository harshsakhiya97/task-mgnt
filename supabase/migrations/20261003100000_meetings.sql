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

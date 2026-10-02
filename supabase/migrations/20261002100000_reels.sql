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

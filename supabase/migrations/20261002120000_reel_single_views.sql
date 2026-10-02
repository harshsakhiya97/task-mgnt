-- 2.0 (owner feedback, 2 Oct): one view count per reel instead of a list of counts.
--   task_reels.actual_views (+ when / who). Anyone on the reel can set it; the Reels report uses it as "actual views".
--   reel_views stays (unused for now) for automatic counts later (2.3).

alter table public.task_reels
  add column if not exists actual_views int check (actual_views >= 0),
  add column if not exists views_counted_at timestamptz,
  add column if not exists views_counted_by uuid references public.profiles(id) on delete set null;

-- Keep any counts already typed in: the newest per platform, added up.
update public.task_reels r set actual_views = x.total, views_counted_at = x.at
  from (
    select task_id, sum(views)::int as total, max(counted_at) as at from (
      select distinct on (task_id, platform) task_id, views, counted_at from public.reel_views order by task_id, platform, counted_at desc
    ) l group by task_id
  ) x
 where x.task_id = r.task_id and r.actual_views is null;

create or replace function private.task_reels_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); t record;
begin
  new.task_id := old.task_id;
  if me is not null and not private.is_admin() then
    select created_by, assigned_by, assigned_to, status into t from public.tasks where id = old.task_id;
    if row(new.expected_views, new.expected_minutes) is distinct from row(old.expected_views, old.expected_minutes) then
      if me not in (coalesce(t.assigned_to, t.created_by), t.created_by, t.assigned_by) then
        raise exception 'Only the editor (or whoever gave the reel) can set the expected views and edit time';
      end if;
      if t.status = 'done' then
        raise exception 'This reel is done, so only an admin can change the expected views or edit time';
      end if;
    end if;
    if new.upload_date is distinct from old.upload_date and me not in (t.created_by, t.assigned_by) then
      raise exception 'Only the person who gave this reel (or an admin) can change the upload date';
    end if;
  end if;
  if new.actual_views is distinct from old.actual_views then
    new.views_counted_at := case when new.actual_views is null then null else now() end;
    new.views_counted_by := case when new.actual_views is null then null else me end;
  else
    new.views_counted_at := old.views_counted_at;
    new.views_counted_by := old.views_counted_by;
  end if;
  new.caption := nullif(btrim(new.caption), '');
  new.instagram_url := nullif(btrim(new.instagram_url), '');
  new.youtube_url := nullif(btrim(new.youtube_url), '');
  if new.posted_at is null and old.posted_at is null and (new.instagram_url is not null or new.youtube_url is not null) then
    new.posted_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Report: views_24h / latest_views now both = the one count (same columns, so the app keeps working).
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
    r.expected_views, r.actual_views, r.actual_views, r.views_counted_at,
    r.expected_minutes,
    coalesce(te.mins, 0)::int, coalesce(te.running, false)
  from public.tasks t
  join public.task_reels r on r.task_id = t.id
  left join public.profiles p on p.id = t.assigned_to
  left join public.teams tm on tm.id = p.team_id
  left join lateral (
    select round(sum(extract(epoch from coalesce(e.ended_at, now()) - e.started_at)) / 60) as mins,
           bool_or(e.ended_at is null) as running
      from public.task_time_entries e where e.task_id = t.id
  ) te on true
  where t.kind = 'reel' and t.due_date between p_from and p_to
    and (p_team is null or p.team_id = p_team)
  order by t.due_date, t.task_no;
end $$;

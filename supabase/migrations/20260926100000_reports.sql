-- =====================================================================
-- v1.1 Reports: per-person numbers for a date range (admin only).
-- A task belongs to the range by its due date. Its deadline is the end
-- time on the due date, or the end of that day when it has no time (IST).
--   on_time  = done at or before the deadline
--   late     = done after the deadline
--   expired  = not done and the deadline has passed
--   pending  = not done and the deadline is still ahead
-- =====================================================================

create or replace function private.task_deadline(p_due date, p_end time)
returns timestamptz language sql immutable set search_path = '' as $$
  select case when p_due is null then null
    else ((p_due + coalesce(p_end, time '23:59:59')) at time zone 'Asia/Kolkata') end
$$;

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
    where x.due_date between p_from and p_to
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

revoke execute on function public.report_by_person(date, date, uuid) from public, anon;
grant execute on function public.report_by_person(date, date, uuid) to authenticated;

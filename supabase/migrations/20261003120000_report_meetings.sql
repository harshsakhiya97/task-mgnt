-- 2.3 Reports → Meetings (admin): one row per meeting in the dates, with its people and action items.
--   people  = organiser + attendees  [{id, name, team_id, team_name, organiser}]
--   actions = action items (tasks.meeting_id) [{assigned_to, status, expired}]
--   p_team  = only meetings with at least one person from that team.

create or replace function public.report_meetings(p_from date, p_to date, p_team uuid default null)
returns table (
  task_id uuid, task_no int, title text, due_date date, start_time time, end_time time, minutes int,
  status text, organiser_id uuid, organiser_name text, meeting_link text, has_notes boolean,
  people jsonb, actions jsonb
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Only admins can see reports'; end if;
  return query
  with m as (
    select t.*, coalesce(t.assigned_to, t.created_by) as org
      from public.tasks t
     where t.kind = 'meeting' and t.due_date between p_from and p_to
  ), ppl as (
    select m.id as mid, p.id, p.full_name, p.team_id, tm.name as team_name, (p.id = m.org) as organiser
      from m
      join public.profiles p on p.id = m.org or p.id in (select a.user_id from public.task_attendees a where a.task_id = m.id)
      left join public.teams tm on tm.id = p.team_id
  )
  select m.id, m.task_no::int, m.title, m.due_date, m.start_time, m.end_time,
    coalesce(round(extract(epoch from (m.end_time - m.start_time)) / 60), 0)::int,
    m.status::text, m.org, op.full_name, mm.meeting_link, coalesce(btrim(mm.notes), '') <> '',
    coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.full_name, 'team_id', x.team_id, 'team_name', x.team_name, 'organiser', x.organiser)
                order by x.organiser desc, x.full_name) from ppl x where x.mid = m.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('task_id', a.id, 'assigned_to', a.assigned_to, 'status', a.status,
                'expired', a.status <> 'done' and a.due_date is not null and private.task_deadline(a.due_date, a.end_time) < now()))
                from public.tasks a where a.meeting_id = m.id), '[]'::jsonb)
  from m
  left join public.profiles op on op.id = m.org
  left join public.task_meetings mm on mm.task_id = m.id
  where p_team is null or exists (select 1 from ppl x where x.mid = m.id and x.team_id = p_team)
  order by m.due_date, m.start_time nulls last, m.task_no;
end $$;

revoke all on function public.report_meetings(date, date, uuid) from public, anon;
grant execute on function public.report_meetings(date, date, uuid) to authenticated;

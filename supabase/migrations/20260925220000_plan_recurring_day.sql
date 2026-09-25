-- =====================================================================
-- Move ONE future day of a recurring task ("only this date").
-- Creates that day's copy now (normally created at midnight) and sets its
-- time. Callable by the assignee, the creator or an admin.
-- =====================================================================

create or replace function public.plan_recurring_day(
  p_template uuid, p_date date, p_start time, p_end time, p_new_date date default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  r public.recurring_tasks;
  me uuid := (select auth.uid());
  tid uuid;
begin
  select * into r from public.recurring_tasks where id = p_template;
  if not found then raise exception 'Recurring task not found'; end if;
  if me is null or not (me in (r.assigned_to, r.created_by) or private.is_admin()) then
    raise exception 'You cannot change this recurring task';
  end if;
  if p_date < private.today_ist() then raise exception 'That day has already passed'; end if;
  if (p_start is null) <> (p_end is null) or (p_start is not null and p_end <= p_start) then
    raise exception 'End time must be after start time';
  end if;

  perform private.generate_recurring(p_date, p_template);
  select id into tid from public.tasks where recurring_id = p_template and occurrence_date = p_date;
  if tid is null then raise exception 'This day is not part of the schedule'; end if;

  update public.tasks
     set start_time = p_start, end_time = p_end, due_date = coalesce(p_new_date, due_date)
   where id = tid;
  return tid;
end $$;

revoke execute on function public.plan_recurring_day(uuid, date, time, time, date) from public, anon;
grant execute on function public.plan_recurring_day(uuid, date, time, time, date) to authenticated;

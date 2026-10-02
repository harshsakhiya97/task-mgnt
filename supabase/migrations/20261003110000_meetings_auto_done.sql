-- 2.2 Meetings: a meeting is marked Done automatically at its end time (checked every minute),
-- so past meetings don't sit in To Do forever (the organiser can still change it by hand).

create or replace function private.finish_ended_meetings() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.tasks t set status = 'done'
   where t.kind = 'meeting' and t.status <> 'done' and t.due_date is not null
     and private.task_deadline(t.due_date, t.end_time) < now();
  get diagnostics n = row_count;
  return n;
end $$;

select cron.schedule('finish-ended-meetings', '* * * * *', $$select private.finish_ended_meetings()$$);

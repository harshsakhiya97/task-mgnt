-- Reminders: when a task's date, time, status or assignee changes, give its skipped (unsent) reminders
-- another chance. E.g. an automatic reminder skipped because the task was due too soon becomes pending
-- again when the deadline is moved later. The minute job re-checks them against the new values.
create or replace function private.tasks_reminders_recheck() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if row(new.due_date, new.end_time, new.status, new.assigned_to) is not distinct from row(old.due_date, old.end_time, old.status, old.assigned_to) then
    return new;
  end if;
  if new.status = 'done' or private.reminder_deadline(new.due_date, new.end_time) <= now() then return new; end if;
  update public.task_reminders set skipped = null
   where task_id = new.id and sent_at is null and skipped is not null;
  return new;
end $$;
create trigger tasks_reminders_recheck after update of due_date, end_time, status, assigned_to on public.tasks
  for each row execute function private.tasks_reminders_recheck();

-- The "too close" rule compares the reminder time with when the reminder was made; after a date change
-- that's still right: a reminder whose new time is after it was made will be sent.

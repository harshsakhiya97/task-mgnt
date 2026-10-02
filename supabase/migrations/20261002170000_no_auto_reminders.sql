-- 2.0 (owner, 2 Oct): no automatic reminders. Reminders are added only by hand, when someone wants one.
-- Settings → Reminders is removed from the app. The rules table stays (unused); reminders already added stay as they are.

create or replace function private.tasks_auto_reminders() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  return new;
end $$;

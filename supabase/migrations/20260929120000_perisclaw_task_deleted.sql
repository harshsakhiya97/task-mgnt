-- Deleting a task that came from Perisclaw failed: the foreign key sets
-- perisclaw_entries.task_id to NULL, and the row guard refused that update.
-- Now, when a row's task is deleted, the row becomes "Skipped" (reason: task deleted).
-- It can still be added again from the Action column.
create or replace function private.perisclaw_entries_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- The linked task was deleted (ON DELETE SET NULL): free the row.
  if old.task_id is not null and new.task_id is null and old.status = 'created'
     and not exists (select 1 from public.tasks where id = old.task_id) then
    new.status := 'ignored';
    new.reason := 'Its task was deleted';
    new.processed_at := now();
    return new;
  end if;

  if (select auth.uid()) is not null then
    if new.status not in ('ignored', 'created')
       or old.status not in ('needs_review', 'error', 'ignored', 'skipped_existing') then
      raise exception 'Only rows that are not tasks yet can be added or skipped';
    end if;
    new.row_hash := old.row_hash; new.raw := old.raw; new.raw_text := old.raw_text;
    new.row_number := old.row_number; new.parsed := old.parsed; new.created_at := old.created_at;
    new.reviewed_by := (select auth.uid());
    new.processed_at := now();
    if new.status = 'created' and (new.task_id is null or not exists (select 1 from public.tasks where id = new.task_id)) then
      raise exception 'Link the created task';
    end if;
  end if;
  return new;
end $$;

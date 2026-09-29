-- Perisclaw rows: admins can now add or skip ANY row that isn't a task yet,
-- including rows that were already in the sheet when it was connected.
create or replace function private.perisclaw_entries_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
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

-- Existing rows are always skipped when a sheet is connected (admins add them by hand if needed).
update public.perisclaw_settings set import_existing = false;

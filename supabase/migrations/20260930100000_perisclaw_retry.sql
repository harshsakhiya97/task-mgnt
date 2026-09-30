-- Gemini sometimes answers "503 high demand" / "429 too many requests".
-- The sync now retries such rows by itself on the next runs (up to 5 tries per row).
alter table public.perisclaw_entries add column attempts int not null default 0;
update public.perisclaw_entries set attempts = 1 where status in ('created', 'needs_review', 'error');

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
    new.attempts := old.attempts;
    new.reviewed_by := (select auth.uid());
    new.processed_at := now();
    if new.status = 'created' and (new.task_id is null or not exists (select 1 from public.tasks where id = new.task_id)) then
      raise exception 'Link the created task';
    end if;
  end if;
  return new;
end $$;

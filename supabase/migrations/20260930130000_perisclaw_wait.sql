-- Perisclaw: new rows first wait 2 minutes (status 'waiting') before they become tasks,
-- because Perisclaw often edits a row a minute or two after writing it. If the row is edited
-- during the wait, the old version is dropped and only the edited row becomes a task.
alter table public.perisclaw_entries drop constraint perisclaw_entries_status_check;
alter table public.perisclaw_entries add constraint perisclaw_entries_status_check
  check (status in ('waiting', 'processing', 'created', 'needs_review', 'ignored', 'skipped_existing', 'error'));

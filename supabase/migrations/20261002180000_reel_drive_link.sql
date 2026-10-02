-- 2.0: a Google Drive link on reels (the edited video / raw files). Not a post link, so it doesn't set posted_at.
alter table public.task_reels add column if not exists drive_url text;

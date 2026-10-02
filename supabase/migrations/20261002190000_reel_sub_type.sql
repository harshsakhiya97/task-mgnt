-- 2.0: reel sub-type (Podcast Editing, Thumbnail Design, Shoot, …), picked when the reel is given. List lives in src/lib/reels.ts.
alter table public.task_reels add column if not exists sub_type text;

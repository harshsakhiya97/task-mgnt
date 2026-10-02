-- 2.0 (owner feedback, 2 Oct):
--   * Reels have no reminders (no automatic ones, none can be added).
--   * Expected views / edit time are set by the editor (the assignee), not in Add Task.
--     Editor, the person who gave it, or an admin may set them; once the reel is Done only an admin can change them.
--   * New "upload date" (the day the reel should go up), set by whoever gives the reel (or an admin).

alter table public.task_reels add column if not exists upload_date date;

create or replace function private.task_reels_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); t record;
begin
  new.task_id := old.task_id;
  if me is not null and not private.is_admin() then
    select created_by, assigned_by, assigned_to, status into t from public.tasks where id = old.task_id;
    if row(new.expected_views, new.expected_minutes) is distinct from row(old.expected_views, old.expected_minutes) then
      if me not in (coalesce(t.assigned_to, t.created_by), t.created_by, t.assigned_by) then
        raise exception 'Only the editor (or whoever gave the reel) can set the expected views and edit time';
      end if;
      if t.status = 'done' then
        raise exception 'This reel is done, so only an admin can change the expected views or edit time';
      end if;
    end if;
    if new.upload_date is distinct from old.upload_date and me not in (t.created_by, t.assigned_by) then
      raise exception 'Only the person who gave this reel (or an admin) can change the upload date';
    end if;
  end if;
  new.caption := nullif(btrim(new.caption), '');
  new.instagram_url := nullif(btrim(new.instagram_url), '');
  new.youtube_url := nullif(btrim(new.youtube_url), '');
  -- Adding the first link counts as "posted now" unless a time was given.
  if new.posted_at is null and old.posted_at is null and (new.instagram_url is not null or new.youtube_url is not null) then
    new.posted_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Reels: automatic reminders (inserted by tasks_auto_reminders) are quietly skipped; adding one by hand is refused.
create or replace function private.task_reminders_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  t record;
begin
  select id, recurring_id, kind, due_date, assigned_by, assigned_to, created_by into t from public.tasks where id = new.task_id;
  if not found then raise exception 'Task not found'; end if;
  if t.recurring_id is not null then raise exception 'Recurring tasks don''t have reminders'; end if;
  if t.kind = 'reel' then
    if pg_trigger_depth() > 1 then return null; end if;
    raise exception 'Reels don''t have reminders';
  end if;
  if new.minutes_before is not null and t.due_date is null then raise exception 'This task has no due date, so pick an exact time'; end if;
  if new.remind_at is not null then new.direction := 'before'; new.anchor := 'end'; end if;
  new.sent_at := null; new.skipped := null;
  if me is not null and pg_trigger_depth() = 1 then
    new.auto := false;
    new.created_by := me;
    if not private.can_see_task(new.task_id) then raise exception 'You can''t see this task'; end if;
    if not (private.is_admin() or me in (t.assigned_by, t.created_by)
            or (new.target = 'person' and new.person_id = me)
            or (new.target = 'assignee' and t.assigned_to = me)) then
      raise exception 'You can set reminders for yourself only';
    end if;
  end if;
  if new.target = 'assignee' then new.person_id := null; end if;
  if new.target = 'person' and not exists (select 1 from public.profiles where id = new.person_id and is_active) then
    raise exception 'Reminders can only go to active users';
  end if;
  return new;
end $$;

-- (The Reels report reads upload_date from task_reels directly, so report_reels stays as it is.)

-- Reels created before this change: their open reminders are marked skipped.
update public.task_reminders rm set skipped = 'Reels don''t have reminders'
  from public.tasks t where t.id = rm.task_id and t.kind = 'reel' and rm.sent_at is null and rm.skipped is null;

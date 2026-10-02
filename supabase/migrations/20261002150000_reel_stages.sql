-- 2.0 — Reel stages (owner, 2 Oct): Scripting → Editing → Review → Posted.
--   * The stage is separate from the status; the reel is marked Done by hand (status), like any task.
--   * Scripting: the script writer writes it, then reassigns the reel to the editor (and moves it to Editing).
--   * Timer Start → stage Editing (from Scripting). Timer "Editing done" (stop) → stage Review; no longer marks Done.
--   * Review: changes wanted → the manager reassigns it back (and moves it back to Editing).
--   * Saving the first post link (posted_at set) → stage Posted.
--   * Anyone on the reel (or an admin) can change the stage by hand. Stage changes go to the activity log.
--   * Upload (scheduled posting) date gets an optional time.

alter table public.task_reels
  add column if not exists stage text not null default 'scripting' check (stage in ('scripting', 'editing', 'review', 'posted')),
  add column if not exists upload_time time;

-- Existing reels: put them where they are now.
update public.task_reels r set stage = case
    when r.posted_at is not null then 'posted'
    when exists (select 1 from public.task_time_entries e where e.task_id = r.task_id) then 'editing'
    else 'scripting' end
 where r.stage = 'scripting';

create or replace function private.task_reels_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); t record;
begin
  new.task_id := old.task_id;
  if me is not null then
    select created_by, assigned_by, assigned_to, status into t from public.tasks where id = old.task_id;
    if new.expected_minutes is distinct from old.expected_minutes and me is distinct from t.assigned_to then
      raise exception 'Only the editor of this reel can set the expected edit time';
    end if;
    if new.expected_views is distinct from old.expected_views and me is distinct from t.assigned_to then
      raise exception 'Only the editor of this reel can set the expected views';
    end if;
    if row(new.upload_date, new.upload_time) is distinct from row(old.upload_date, old.upload_time)
       and not private.is_admin() and me not in (t.created_by, t.assigned_by) then
      raise exception 'Only the person who gave this reel (or an admin) can change the upload date';
    end if;
  end if;
  if new.upload_date is null then new.upload_time := null; end if;
  if new.actual_views is distinct from old.actual_views then
    new.views_counted_at := case when new.actual_views is null then null else now() end;
    new.views_counted_by := case when new.actual_views is null then null else me end;
  else
    new.views_counted_at := old.views_counted_at;
    new.views_counted_by := old.views_counted_by;
  end if;
  new.caption := nullif(btrim(new.caption), '');
  new.instagram_url := nullif(btrim(new.instagram_url), '');
  new.youtube_url := nullif(btrim(new.youtube_url), '');
  if new.posted_at is null and old.posted_at is null and (new.instagram_url is not null or new.youtube_url is not null) then
    new.posted_at := now();
  end if;
  -- Posting moves the reel to Posted (unless the stage was changed in the same save).
  if new.posted_at is not null and old.posted_at is null and new.stage is not distinct from old.stage then
    new.stage := 'posted';
  end if;
  new.updated_at := now();
  return new;
end $$;

/** Stage changes → activity log. */
create or replace function private.task_reels_log_stage() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.stage is distinct from old.stage then
    insert into public.task_activity (task_id, actor_id, action, old_value, new_value)
    values (new.task_id, (select auth.uid()), 'stage', old.stage, new.stage);
  end if;
  return new;
end $$;
create trigger task_reels_log_stage after update of stage on public.task_reels
  for each row execute function private.task_reels_log_stage();

/** Timer: Start → In Progress (+ stage Editing from Scripting). Stop = editing done → stage Review (status unchanged). */
create or replace function public.task_timer(p_task uuid, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  t record;
  closed int;
begin
  if me is null then raise exception 'Please sign in again'; end if;
  if p_action not in ('start', 'pause', 'stop') then raise exception 'Unknown timer action'; end if;
  select id, assigned_to, status, recurring_id, kind into t from public.tasks where id = p_task;
  if not found or not private.can_see_task(p_task) then raise exception 'Task not found'; end if;

  if p_action = 'start' then
    if t.assigned_to is distinct from me then raise exception 'Only the person this task is assigned to can start the timer'; end if;
    with x as (
      update public.task_time_entries set ended_at = now() where user_id = me and ended_at is null and task_id <> p_task returning task_id
    )
    insert into public.task_activity (task_id, actor_id, action, new_value) select x.task_id, me, 'timer', 'paused' from x;
    if not exists (select 1 from public.task_time_entries where user_id = me and task_id = p_task and ended_at is null) then
      insert into public.task_time_entries (task_id, user_id) values (p_task, me);
      insert into public.task_activity (task_id, actor_id, action, new_value) values (p_task, me, 'timer', 'started');
    end if;
    if t.status <> 'in_progress' then update public.tasks set status = 'in_progress' where id = p_task; end if;
    if t.kind = 'reel' then
      update public.task_reels set stage = 'editing' where task_id = p_task and stage = 'scripting';
    end if;
    return;
  end if;

  if me is distinct from t.assigned_to and not private.is_admin() then
    raise exception 'Only the person this task is assigned to (or an admin) can pause or stop the timer';
  end if;
  update public.task_time_entries set ended_at = now() where task_id = p_task and ended_at is null;
  get diagnostics closed = row_count;
  if p_action = 'pause' then
    if closed > 0 then
      insert into public.task_activity (task_id, actor_id, action, new_value) values (p_task, me, 'timer', 'paused');
    end if;
  else
    insert into public.task_activity (task_id, actor_id, action, new_value) values (p_task, me, 'timer', 'stopped');
    if t.kind = 'reel' then
      update public.task_reels set stage = 'review' where task_id = p_task and stage in ('scripting', 'editing');
    elsif t.status <> 'done' then
      update public.tasks set status = 'done' where id = p_task;
    end if;
  end if;
end $$;

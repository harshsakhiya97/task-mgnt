-- 2.0: owner asked to revert reel stages (2 Oct). Back to: timer Stop = editing finished → Done;
-- no stage moves. The stage / upload_time columns stay in the table, unused.

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
    if new.upload_date is distinct from old.upload_date and not private.is_admin() and me not in (t.created_by, t.assigned_by) then
      raise exception 'Only the person who gave this reel (or an admin) can change the upload date';
    end if;
  end if;
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
  new.updated_at := now();
  return new;
end $$;

-- Stage logging is off (the trigger stays but does nothing).
create or replace function private.task_reels_log_stage() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  return new;
end $$;

create or replace function public.task_timer(p_task uuid, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  t record;
  closed int;
begin
  if me is null then raise exception 'Please sign in again'; end if;
  if p_action not in ('start', 'pause', 'stop') then raise exception 'Unknown timer action'; end if;
  select id, assigned_to, status, recurring_id into t from public.tasks where id = p_task;
  if not found or not private.can_see_task(p_task) then raise exception 'Task not found'; end if;

  if p_action = 'start' then
    if t.assigned_to is distinct from me then raise exception 'Only the person this task is assigned to can start the timer'; end if;
    -- One running timer per person: starting here pauses the other one.
    with x as (
      update public.task_time_entries set ended_at = now() where user_id = me and ended_at is null and task_id <> p_task returning task_id
    )
    insert into public.task_activity (task_id, actor_id, action, new_value) select x.task_id, me, 'timer', 'paused' from x;
    if not exists (select 1 from public.task_time_entries where user_id = me and task_id = p_task and ended_at is null) then
      insert into public.task_time_entries (task_id, user_id) values (p_task, me);
      insert into public.task_activity (task_id, actor_id, action, new_value) values (p_task, me, 'timer', 'started');
    end if;
    if t.status <> 'in_progress' then update public.tasks set status = 'in_progress' where id = p_task; end if;
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
    if t.status <> 'done' then update public.tasks set status = 'done' where id = p_task; end if;
  end if;
end $$;

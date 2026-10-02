-- 2.0: a reel's timer can only start once the editor has set the expected views and edit time.

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
    if t.kind = 'reel' and exists (select 1 from public.task_reels r where r.task_id = p_task
                                   and (r.expected_views is null or r.expected_minutes is null)) then
      raise exception 'Set the expected views and edit time (🎬 Reel tab) before you start';
    end if;
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

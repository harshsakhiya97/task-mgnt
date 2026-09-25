-- =====================================================================
-- In-app notifications
--  1. New task / reassignment -> the new assignee ("A has assigned X to you")
--                              -> all admins     ("A has assigned X to B")
--  2. Action by the current assignee (comment, status change, edit, file,
--     reassignment) -> the assigner (whoever handed it to them) + all admins
--  Nobody is notified about their own action. Each person gets at most one
--  notification per event.
-- =====================================================================

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  type text not null,            -- assigned | reassigned | status | comment | attachment | updated
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications(user_id) where read_at is null;

alter table public.notifications enable row level security;
create policy "notifications own read" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "notifications own mark read" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "notifications own delete" on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.notifications from anon;
revoke insert, update on public.notifications from authenticated;   -- only triggers create them
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Live updates in the browser
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- Helpers -------------------------------------------------------------
create or replace function private.person_name(p uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select full_name from public.profiles where id = p), 'Someone')
$$;

-- Send one notification to each recipient (skips nulls, the actor and duplicates).
create or replace function private.notify(recipients uuid[], p_task uuid, p_actor uuid, p_type text, p_message text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, task_id, actor_id, type, message)
  select distinct r, p_task, p_actor, p_type, p_message
  from unnest(recipients) r
  where r is not null and r is distinct from p_actor
    and exists (select 1 from public.profiles where id = r and is_active)
$$;

create or replace function private.active_admins() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(id), '{}') from public.profiles where role = 'admin' and is_active
$$;

create or replace function private.status_label(s text) returns text
language sql immutable set search_path = '' as $$
  select case s when 'todo' then 'To Do' when 'in_progress' then 'In Progress'
                when 'done' then 'Done' when 'blocked' then 'Blocked' else s end
$$;

-- Task created / updated ------------------------------------------------
create or replace function private.tasks_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := coalesce((select auth.uid()), case when tg_op = 'INSERT' then new.created_by end);
  who text;
  t text := '"' || new.title || '"';
  admins uuid[] := private.active_admins();
  by_assignee boolean;
  changes text[] := '{}';
begin
  if actor is null then return new; end if;           -- system/SQL changes: no notifications
  who := private.person_name(actor);

  -- 1. New task
  if tg_op = 'INSERT' then
    perform private.notify(array[new.assigned_to], new.id, actor, 'assigned', who || ' has assigned ' || t || ' to you');
    perform private.notify(array(select unnest(admins) except select new.assigned_to), new.id, actor, 'assigned',
      who || ' has assigned ' || t || ' to ' || private.person_name(new.assigned_to));
    return new;
  end if;

  by_assignee := actor = old.assigned_to;

  -- 1b. Reassignment
  if new.assigned_to is distinct from old.assigned_to then
    perform private.notify(array[new.assigned_to], new.id, actor, 'reassigned', who || ' has assigned ' || t || ' to you');
    perform private.notify(
      array(select unnest(admins || case when by_assignee then array[old.assigned_by] else '{}'::uuid[] end)
            except select new.assigned_to),
      new.id, actor, 'reassigned', who || ' has reassigned ' || t || ' to ' || private.person_name(new.assigned_to));
    return new;
  end if;

  -- 2. Other changes made by the current assignee -> assigner + admins
  if not by_assignee then return new; end if;

  if new.status is distinct from old.status then
    perform private.notify(admins || new.assigned_by, new.id, actor, 'status',
      who || ' changed the status of ' || t || ' to ' || private.status_label(new.status::text));
  end if;

  if new.title is distinct from old.title then changes := changes || 'title'::text; end if;
  if new.description is distinct from old.description then changes := changes || 'description'::text; end if;
  if new.due_date is distinct from old.due_date then changes := changes || 'due date'::text; end if;
  if new.priority is distinct from old.priority then changes := changes || 'priority'::text; end if;
  if array_length(changes, 1) > 0 then
    perform private.notify(admins || new.assigned_by, new.id, actor, 'updated',
      who || ' updated the ' || array_to_string(changes, ', ') || ' of ' || t);
  end if;
  return new;
end $$;

drop trigger if exists tasks_notify on public.tasks;
create trigger tasks_notify after insert or update on public.tasks
  for each row execute function private.tasks_notify();

-- Comments & attachments by the current assignee -> assigner + admins ---
create or replace function private.child_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  tk record;
  actor uuid;
  msg text;
begin
  select id, title, assigned_to, assigned_by into tk from public.tasks where id = new.task_id;
  if tg_table_name = 'task_comments' then
    actor := new.author_id;
    msg := private.person_name(actor) || ' commented on "' || tk.title || '": ' ||
           case when length(new.body) > 80 then left(new.body, 80) || '…' else new.body end;
  else
    actor := new.uploaded_by;
    msg := private.person_name(actor) || ' attached ' || new.file_name || ' to "' || tk.title || '"';
  end if;

  if actor = tk.assigned_to then
    perform private.notify(private.active_admins() || tk.assigned_by, tk.id, actor,
      case when tg_table_name = 'task_comments' then 'comment' else 'attachment' end, msg);
  end if;
  return new;
end $$;

drop trigger if exists task_comments_notify on public.task_comments;
create trigger task_comments_notify after insert on public.task_comments
  for each row execute function private.child_notify();
drop trigger if exists task_attachments_notify on public.task_attachments;
create trigger task_attachments_notify after insert on public.task_attachments
  for each row execute function private.child_notify();

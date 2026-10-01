-- 1.4.1 — Phone notifications also for "task assigned to you" and comments (WhatsApp + bell stay as they are).
-- Follows the bell: every new notification of these types also queues a push for that person, if they turned
-- phone notifications on (no device = nothing queued).
create or replace function private.notifications_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t record; push_title text;
begin
  if new.type not in ('assigned', 'comment') or new.task_id is null then return new; end if;
  if not exists (select 1 from public.push_subscriptions s where s.user_id = new.user_id) then return new; end if;
  select tk.id, tk.task_no, tk.title, tk.assigned_to into t from public.tasks tk where tk.id = new.task_id;
  if not found then return new; end if;
  -- "assigned" bells also go to admins ("X assigned … to Y"); only the new assignee gets a phone notification.
  if new.type = 'assigned' and t.assigned_to is distinct from new.user_id then return new; end if;
  push_title := case new.type when 'assigned' then '📋 New task · TM-' else '💬 TM-' end || t.task_no || ' · ' || left(t.title, 70);
  insert into public.push_outbox (user_id, task_id, title, body, url, tag)
  values (new.user_id, t.id, push_title, left(new.message, 300), '/tasks?task=' || t.id,
          case new.type when 'comment' then 'comment-' || t.id else 'assigned-' || t.id end);
  perform private.push_kick();
  return new;
end $$;

create trigger notifications_push after insert on public.notifications
  for each row execute function private.notifications_push();

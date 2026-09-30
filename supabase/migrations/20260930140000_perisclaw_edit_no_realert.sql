-- Perisclaw: an edited sheet row now updates the task it already made (it links to the same task).
-- Don't send the "user not found" WhatsApp/bell again for that same task.
create or replace function private.perisclaw_unassigned_alert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t record;
  person text := coalesce(nullif(btrim(new.parsed->>'assignee_text'), ''), 'no name given');
  a uuid;
begin
  if new.status <> 'created' or new.task_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'created' and old.task_id is not distinct from new.task_id then return new; end if;
  -- Another row (an earlier version of this one) already made this task: admins were told then.
  if exists (select 1 from public.perisclaw_entries e where e.task_id = new.task_id and e.id <> new.id) then return new; end if;
  select id, task_no, title, assigned_to into t from public.tasks where id = new.task_id;
  if not found or t.assigned_to is not null then return new; end if;

  foreach a in array private.active_admins() loop
    perform private.wa_enqueue('task_unassigned', a, jsonb_build_object(
      'name', private.wa_text(private.person_name(a), 60),
      'person', private.wa_text(person, 60),
      'task', 'TM-' || t.task_no || ' – ' || private.wa_text(t.title, 120),
      'link', private.setting('app_url') || '/tasks?task=' || t.id
    ), t.id);
  end loop;
  perform private.notify(private.active_admins(), t.id, null, 'unassigned',
    'Perisclaw added "' || t.title || '" but "' || person || '" is not a user yet. Create the user and assign this task.');
  return new;
end $$;

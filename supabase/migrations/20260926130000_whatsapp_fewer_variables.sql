-- =====================================================================
-- WhatsApp templates: fewer variables (Meta rejects templates with too
-- many variables for their length). Task number and title are now one
-- variable: {{task}} = "TM-125 – Prepare TVS weekly report".
-- =====================================================================

create or replace function private.wa_task_assigned() returns trigger
language plpgsql security definer set search_path = '' as $$
declare actor uuid := coalesce((select auth.uid()), new.assigned_by);
begin
  if new.recurring_id is not null then return new; end if;
  if tg_op = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to then return new; end if;
  if new.assigned_to = actor then return new; end if;
  perform private.wa_enqueue('task_assigned', new.assigned_to, jsonb_build_object(
    'name', private.wa_text(private.person_name(new.assigned_to), 60),
    'assigner', private.wa_text(private.person_name(actor), 60),
    'task', 'TM-' || new.task_no || ' – ' || private.wa_text(new.title, 120),
    'due', private.wa_due_text(new.due_date, new.start_time, new.end_time),
    'link', private.setting('app_url') || '/tasks?task=' || new.id
  ), new.id);
  return new;
end $$;

create or replace function private.wa_recurring_assigned() returns trigger
language plpgsql security definer set search_path = '' as $$
declare actor uuid := coalesce((select auth.uid()), new.created_by);
begin
  if tg_op = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to then return new; end if;
  if new.assigned_to = actor then return new; end if;
  perform private.wa_enqueue('task_assigned', new.assigned_to, jsonb_build_object(
    'name', private.wa_text(private.person_name(new.assigned_to), 60),
    'assigner', private.wa_text(private.person_name(actor), 60),
    'task', 'Recurring – ' || private.wa_text(new.title, 120),
    'due', 'every ' || private.weekday_names(new.weekdays) || ' from ' || to_char(new.start_date, 'DD-Mon-YYYY'),
    'link', private.setting('app_url') || '/tasks?view=recurring'
  ));
  return new;
end $$;

create or replace function private.wa_task_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t public.tasks;
  pending public.whatsapp_outbox;
  more int;
begin
  select * into t from public.tasks where id = new.task_id;
  if not found or new.author_id <> t.assigned_to or t.assigned_by is null or t.assigned_by = new.author_id then
    return new;
  end if;

  select * into pending from public.whatsapp_outbox
   where kind = 'task_comment' and task_id = t.id and recipient_id = t.assigned_by and status = 'queued'
   order by created_at desc limit 1 for update;

  if found then
    more := coalesce((pending.params->>'more_count')::int, 0) + 1;
    update public.whatsapp_outbox set
      params = pending.params || jsonb_build_object(
        'comment', private.wa_text(new.body, 150) || ' (+' || more || ' more)',
        'more_count', more),
      send_after = now() + interval '2 minutes'
    where id = pending.id;
  else
    perform private.wa_enqueue('task_comment', t.assigned_by, jsonb_build_object(
      'name', private.wa_text(private.person_name(t.assigned_by), 60),
      'commenter', private.wa_text(private.person_name(new.author_id), 60),
      'task', 'TM-' || t.task_no || ' – ' || private.wa_text(t.title, 120),
      'comment', private.wa_text(new.body, 150),
      'link', private.setting('app_url') || '/tasks?task=' || t.id
    ), t.id, interval '2 minutes');
  end if;
  return new;
end $$;

-- =====================================================================
-- v1.1 WhatsApp (WATI) notifications.
-- Database triggers put messages in public.whatsapp_outbox; the Edge
-- Function `whatsapp-sender` sends them through WATI (run every minute by
-- pg_cron while something is waiting). Nothing is sent until the WATI
-- secrets are set on the function. Messages older than 24 h are dropped.
--
--   task_assigned      -> assignee, when a task (or recurring task) is assigned / reassigned to them
--   task_comment       -> assigner, when the assignee comments (comments within 2 min are combined)
--   daily_task_report  -> every active admin, at 20:00 IST
-- Nobody is messaged about their own action; daily copies of recurring
-- tasks don't send anything.
-- =====================================================================

create extension if not exists pg_net with schema extensions;

create table public.whatsapp_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('task_assigned', 'task_comment', 'daily_task_report')),
  recipient_id uuid references public.profiles(id) on delete cascade,
  phone text,
  template text not null,
  params jsonb not null default '{}'::jsonb,       -- {variable: value}, in template order
  task_id uuid references public.tasks(id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped', 'expired')),
  attempts int not null default 0,
  last_error text,
  send_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index whatsapp_outbox_queue_idx on public.whatsapp_outbox (status, send_after);
create index whatsapp_outbox_created_idx on public.whatsapp_outbox (created_at desc);

alter table public.whatsapp_outbox enable row level security;
create policy "whatsapp log admin read" on public.whatsapp_outbox for select to authenticated using ((select private.is_admin()));
revoke all on public.whatsapp_outbox from anon;
revoke insert, update, delete on public.whatsapp_outbox from authenticated;
grant select on public.whatsapp_outbox to authenticated;

-- Settings the database needs (not secret): the app link used in messages.
create table private.app_settings (key text primary key, value text not null);
insert into private.app_settings values ('app_url', 'https://pride.viralsakhiya.com');

create or replace function private.setting(p_key text) returns text
language sql stable security definer set search_path = '' as $$
  select value from private.app_settings where key = p_key
$$;

-- "98673 33582" / "+91 9867333582" / "09867333582" -> "919867333582"; null if unusable.
create or replace function private.wa_phone(p_phone text) returns text
language plpgsql immutable set search_path = '' as $$
declare d text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if length(d) = 11 and left(d, 1) = '0' then d := substr(d, 2); end if;
  if length(d) = 10 then d := '91' || d; end if;
  if length(d) < 11 or length(d) > 15 then return null; end if;
  return d;
end $$;

-- WhatsApp template parameters can't contain new lines or long runs of spaces.
create or replace function private.wa_text(p text, p_max int default 200) returns text
language sql immutable set search_path = '' as $$
  select left(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')), p_max)
$$;

create or replace function private.wa_enqueue(p_kind text, p_recipient uuid, p_params jsonb, p_task uuid default null, p_delay interval default '0')
returns void language plpgsql security definer set search_path = '' as $$
declare
  ph text;
  tmpl text := p_kind;   -- template name in WATI = kind (see whatsapp-sender to override)
begin
  select private.wa_phone(phone) into ph from public.profiles where id = p_recipient and is_active;
  if not found then return; end if;
  insert into public.whatsapp_outbox (kind, recipient_id, phone, template, params, task_id, send_after, status, last_error)
  values (p_kind, p_recipient, ph, tmpl, p_params, p_task, now() + p_delay,
          case when ph is null then 'skipped' else 'queued' end,
          case when ph is null then 'No valid phone number on the profile' end);
end $$;

create or replace function private.wa_due_text(p_due date, p_start time, p_end time) returns text
language sql immutable set search_path = '' as $$
  select case when p_due is null then 'no due date'
    else to_char(p_due, 'DD-Mon-YYYY')
      || case when p_start is not null then ', ' || to_char(p_start, 'HH12:MI AM')
           || case when p_end is not null then ' - ' || to_char(p_end, 'HH12:MI AM') else '' end
         else '' end
  end
$$;

-- ---------------------------------------------------------------------
-- Task assigned / reassigned (one-off tasks and recurring schedules;
-- the daily copies of a recurring task are skipped).
-- ---------------------------------------------------------------------
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
    'task_no', 'TM-' || new.task_no,
    'title', private.wa_text(new.title, 120),
    'due', private.wa_due_text(new.due_date, new.start_time, new.end_time),
    'link', private.setting('app_url') || '/tasks?task=' || new.id
  ), new.id);
  return new;
end $$;

create trigger tasks_whatsapp after insert or update of assigned_to on public.tasks
  for each row execute function private.wa_task_assigned();

create or replace function private.wa_recurring_assigned() returns trigger
language plpgsql security definer set search_path = '' as $$
declare actor uuid := coalesce((select auth.uid()), new.created_by);
begin
  if tg_op = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to then return new; end if;
  if new.assigned_to = actor then return new; end if;
  perform private.wa_enqueue('task_assigned', new.assigned_to, jsonb_build_object(
    'name', private.wa_text(private.person_name(new.assigned_to), 60),
    'assigner', private.wa_text(private.person_name(actor), 60),
    'task_no', 'Recurring',
    'title', private.wa_text(new.title, 120),
    'due', 'every ' || private.weekday_names(new.weekdays) || ' from ' || to_char(new.start_date, 'DD-Mon-YYYY'),
    'link', private.setting('app_url') || '/tasks?view=recurring'
  ));
  return new;
end $$;

create trigger recurring_whatsapp after insert or update of assigned_to on public.recurring_tasks
  for each row execute function private.wa_recurring_assigned();

-- ---------------------------------------------------------------------
-- Assignee comments -> assigner. Comments within 2 minutes are combined
-- into one message (the latest text + "and N more").
-- ---------------------------------------------------------------------
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
      'task_no', 'TM-' || t.task_no,
      'title', private.wa_text(t.title, 120),
      'comment', private.wa_text(new.body, 150),
      'link', private.setting('app_url') || '/tasks?task=' || t.id
    ), t.id, interval '2 minutes');
  end if;
  return new;
end $$;

create trigger task_comments_whatsapp after insert on public.task_comments
  for each row execute function private.wa_task_comment();

-- ---------------------------------------------------------------------
-- Day-end report to admins (20:00 IST). Counts tasks due today.
-- ---------------------------------------------------------------------
create or replace function private.wa_daily_report(p_day date default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  d date := coalesce(p_day, private.today_ist());
  total int; done int; expired int; pending int; overdue_open int; n int := 0;
  a uuid;
begin
  select count(*),
         count(*) filter (where status = 'done'),
         count(*) filter (where status <> 'done' and private.task_deadline(due_date, end_time) < now()),
         count(*) filter (where status <> 'done' and private.task_deadline(due_date, end_time) >= now())
    into total, done, expired, pending
    from public.tasks where due_date = d;
  select count(*) into overdue_open from public.tasks where status <> 'done' and due_date < d;

  foreach a in array private.active_admins() loop
    perform private.wa_enqueue('daily_task_report', a, jsonb_build_object(
      'name', private.wa_text(private.person_name(a), 60),
      'date', to_char(d, 'DD-Mon-YYYY'),
      'total', total::text, 'done', done::text, 'expired', expired::text, 'pending', pending::text,
      'overdue', overdue_open::text,
      'link', private.setting('app_url') || '/reports'
    ));
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Sender side: the Edge Function claims a batch (service role only).
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_claim_batch(p_limit int default 20)
returns setof public.whatsapp_outbox
language plpgsql security definer set search_path = '' as $$
begin
  -- Old messages are no longer useful (e.g. queued before WATI was set up).
  update public.whatsapp_outbox set status = 'expired', last_error = 'Not sent within 24 hours'
   where status in ('queued', 'sending') and created_at < now() - interval '24 hours';
  -- A batch stuck in "sending" (function crashed) goes back to the queue.
  update public.whatsapp_outbox set status = 'queued'
   where status = 'sending' and send_after < now() - interval '10 minutes';

  return query
  update public.whatsapp_outbox o set status = 'sending', attempts = o.attempts + 1, send_after = now()
   where o.id in (
     select id from public.whatsapp_outbox
      where status = 'queued' and send_after <= now()
      order by send_after limit p_limit
      for update skip locked)
  returning o.*;
end $$;

create or replace function public.whatsapp_mark(p_id uuid, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.whatsapp_outbox set
    status = case when p_ok then 'sent' when attempts >= 5 then 'failed' else 'queued' end,
    sent_at = case when p_ok then now() end,
    last_error = case when p_ok then null else left(p_error, 500) end,
    -- retry after 1, 2, 4, 8 minutes
    send_after = case when p_ok then send_after else now() + (interval '1 minute' * power(2, greatest(attempts - 1, 0))) end
  where id = p_id;
end $$;

revoke execute on function public.whatsapp_claim_batch(int) from public, anon, authenticated;
revoke execute on function public.whatsapp_mark(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.whatsapp_claim_batch(int) to service_role;
grant execute on function public.whatsapp_mark(uuid, boolean, text) to service_role;

-- ---------------------------------------------------------------------
-- Schedules (UTC): sender every minute (only calls the function when
-- something is due); day-end report at 14:30 UTC = 20:00 IST.
-- ---------------------------------------------------------------------
create or replace function private.wa_kick() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.whatsapp_outbox where status = 'queued' and send_after <= now()) then
    perform net.http_post(
      url := 'https://tazlvzjalhxsudceabqy.supabase.co/functions/v1/whatsapp-sender',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 30000);
  end if;
end $$;

select cron.schedule('whatsapp-sender', '* * * * *', $$select private.wa_kick()$$);
select cron.schedule('whatsapp-daily-report', '30 14 * * *', $$select private.wa_daily_report()$$);

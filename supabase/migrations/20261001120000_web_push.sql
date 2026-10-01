-- 1.4 — Reminders as phone notifications (Web Push) instead of WhatsApp.
-- Reminders now go to: the bell (Notifications → Reminders tab) + a push notification on every phone/browser
-- where the person turned notifications on. Task assigned / comments stay on WhatsApp + bell.

-- ---------- Where to send: one row per browser / installed app that allowed notifications ----------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  last_error text
);
create index push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "own push subscriptions read" on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own push subscriptions add" on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own push subscriptions remove" on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.push_subscriptions from anon;
revoke update on public.push_subscriptions from authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;

/** Save this browser's subscription for me (re-subscribing on the same endpoint moves it to me / refreshes keys). */
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'Not signed in'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (me, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update set user_id = me, p256dh = excluded.p256dh, auth = excluded.auth,
    user_agent = excluded.user_agent, last_error = null;
end $$;

-- ---------- Queue of push messages (sent by the push-sender Edge Function) ----------
create table public.push_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  title text not null,
  body text not null,
  url text,
  tag text,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'no_device', 'failed')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index push_outbox_queued on public.push_outbox (created_at) where status = 'queued';
alter table public.push_outbox enable row level security;
create policy "push outbox admin read" on public.push_outbox for select to authenticated using ((select private.is_admin()));
revoke all on public.push_outbox from anon, authenticated;
grant select on public.push_outbox to authenticated;

/** Edge Function: take up to n queued messages with the devices to send them to. */
create or replace function public.push_claim_batch(p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  -- Messages stuck in 'sending' (function crashed) go back to the queue after 5 minutes.
  update public.push_outbox set status = 'queued' where status = 'sending' and sent_at is null and created_at < now() - interval '5 minutes';
  with picked as (
    select id from public.push_outbox where status = 'queued' and created_at > now() - interval '3 hours'
    order by created_at limit p_limit for update skip locked
  ), upd as (
    update public.push_outbox o set status = 'sending', attempts = attempts + 1 from picked where o.id = picked.id
    returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', u.id, 'title', u.title, 'body', u.body, 'url', u.url, 'tag', u.tag,
    'subs', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]')
             from public.push_subscriptions s where s.user_id = u.user_id))), '[]')
    into out from upd u;
  -- Too old to be useful.
  update public.push_outbox set status = 'failed', last_error = 'Expired (not sent within 3 hours)'
   where status = 'queued' and created_at <= now() - interval '3 hours';
  return out;
end $$;

/** Edge Function: result per message, and per device (gone devices are removed). */
create or replace function public.push_mark(p_id uuid, p_status text, p_error text default null,
  p_ok_subs uuid[] default '{}', p_gone_subs uuid[] default '{}', p_failed_subs jsonb default '{}')
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.push_outbox set
    status = case when p_status = 'retry' and attempts < 3 then 'queued' when p_status = 'retry' then 'failed' else p_status end,
    last_error = p_error, sent_at = case when p_status = 'sent' then now() end
  where id = p_id;
  update public.push_subscriptions set last_ok_at = now(), last_error = null where id = any(p_ok_subs);
  delete from public.push_subscriptions where id = any(p_gone_subs);
  update public.push_subscriptions s set last_error = left(p_failed_subs ->> s.id::text, 300)
   where s.id::text in (select jsonb_object_keys(p_failed_subs));
end $$;

-- ---------- VAPID keys (identify our server to the push services). Made once by push-sender, kept in Vault. ----------
create or replace function public.push_get_keys() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'public', (select value from private.app_settings where key = 'vapid_public_key'),
    'private', (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_private_key' limit 1),
    'subject', coalesce((select value from private.app_settings where key = 'app_url'), 'https://pride.viralsakhiya.com'))
$$;

create or replace function public.push_set_keys(p_public text, p_private text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from private.app_settings where key = 'vapid_public_key') then return; end if;   -- never replace: devices are tied to it
  perform vault.create_secret(p_private, 'vapid_private_key', 'Web Push (VAPID) private key for push-sender');
  insert into private.app_settings (key, value) values ('vapid_public_key', p_public);
end $$;

/** The app needs the public key to subscribe a browser. */
create or replace function public.push_public_key() returns text
language sql stable security definer set search_path = '' as $$
  select value from private.app_settings where key = 'vapid_public_key'
$$;

revoke all on function public.push_subscribe(text, text, text, text) from public, anon;
revoke all on function public.push_claim_batch(int) from public, anon, authenticated;
revoke all on function public.push_mark(uuid, text, text, uuid[], uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.push_get_keys() from public, anon, authenticated;
revoke all on function public.push_set_keys(text, text) from public, anon, authenticated;
revoke all on function public.push_public_key() from public, anon;
grant execute on function public.push_subscribe(text, text, text, text) to authenticated;
grant execute on function public.push_public_key() to authenticated;
grant execute on function public.push_claim_batch(int), public.push_mark(uuid, text, text, uuid[], uuid[], jsonb),
  public.push_get_keys(), public.push_set_keys(text, text) to service_role;

/** Call push-sender right away when there's something to send (same idea as wa_kick). */
create or replace function private.push_kick() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.push_outbox where status = 'queued') then
    perform net.http_post(
      url := 'https://tazlvzjalhxsudceabqy.supabase.co/functions/v1/push-sender',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 30000);
  end if;
end $$;

-- ---------- Reminders: bell + push (no more WhatsApp) ----------
create or replace function private.send_due_reminders() returns int
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  fire timestamptz;
  deadline timestamptz;
  who uuid;
  why text;
  due text;
  sent int := 0;
begin
  for r in
    select rm.id, rm.target, rm.person_id, rm.minutes_before, rm.remind_at, rm.auto, rm.created_at,
           t.id as task_id, t.task_no, t.title, t.status, t.due_date, t.start_time, t.end_time, t.assigned_to
      from public.task_reminders rm join public.tasks t on t.id = rm.task_id
     where rm.sent_at is null and rm.skipped is null
       and coalesce(rm.remind_at, private.reminder_deadline(t.due_date, t.end_time) - make_interval(mins => rm.minutes_before)) <= now()
     order by rm.created_at
     for update of rm skip locked
     limit 200
  loop
    deadline := private.reminder_deadline(r.due_date, r.end_time);
    fire := coalesce(r.remind_at, deadline - make_interval(mins => r.minutes_before));
    who := case r.target when 'assignee' then r.assigned_to else r.person_id end;
    why := case
      when r.status = 'done' then 'Task was already done'
      when who is null then 'Task had no assignee'
      when r.minutes_before is not null and deadline < now() then 'Deadline had already passed'
      when r.auto and fire < r.created_at then 'Task was added too close to the deadline for this reminder'
      when fire < now() - interval '3 hours' then 'Missed (more than 3 hours late)'
    end;
    if why is not null then
      update public.task_reminders set skipped = why where id = r.id;
      continue;
    end if;
    due := private.reminder_due_text(r.due_date, r.start_time, r.end_time)
           || case when deadline > now() then ' (' || private.human_until(deadline) || ')' else '' end;
    perform private.notify(array[who], r.task_id, null, 'reminder',
      'Reminder: "' || r.title || '" is due ' || due || '. Status: ' || private.status_label(r.status::text));
    if exists (select 1 from public.profiles where id = who and is_active) then
      insert into public.push_outbox (user_id, task_id, title, body, url, tag)
      values (who, r.task_id,
        '⏰ TM-' || r.task_no || ' · ' || left(r.title, 80),
        'Due ' || due || ' · ' || private.status_label(r.status::text),
        '/tasks?task=' || r.task_id,
        'reminder-' || r.id);
    end if;
    update public.task_reminders set sent_at = now() where id = r.id;
    sent := sent + 1;
  end loop;
  if sent > 0 then perform private.push_kick(); end if;
  return sent;
end $$;

-- Safety net: send anything still queued every minute (e.g. if the instant call failed).
select cron.schedule('push-sender', '* * * * *', $$select private.push_kick()$$);

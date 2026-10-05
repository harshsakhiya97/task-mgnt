-- WhatsApp pause switch (owner, 5 Oct): while private.app_settings 'whatsapp_paused' = 'on', nothing new is
-- queued for WhatsApp — the message is logged as Skipped ("WhatsApp paused") in WhatsApp Logs instead.
-- Bell + phone notifications are not affected.
-- Resume: update private.app_settings set value = 'off' where key = 'whatsapp_paused';

insert into private.app_settings (key, value) values ('whatsapp_paused', 'on')
  on conflict (key) do update set value = 'on';

create or replace function private.wa_enqueue(p_kind text, p_recipient uuid, p_params jsonb, p_task uuid default null, p_delay interval default '0'::interval)
returns void language plpgsql security definer set search_path = '' as $$
declare
  ph text;
  tmpl text := p_kind;
  paused boolean := coalesce(private.setting('whatsapp_paused'), 'off') = 'on';
begin
  select private.wa_phone(phone) into ph from public.profiles where id = p_recipient and is_active;
  if not found then return; end if;
  insert into public.whatsapp_outbox (kind, recipient_id, phone, template, params, task_id, send_after, status, last_error)
  values (p_kind, p_recipient, ph, tmpl, p_params, p_task, now() + p_delay,
          case when paused or ph is null then 'skipped' else 'queued' end,
          case when paused then 'WhatsApp paused' when ph is null then 'No valid phone number on the profile' end);
end $$;

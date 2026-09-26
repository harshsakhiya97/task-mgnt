-- Send WhatsApp messages right away instead of waiting for the next
-- once-a-minute run: when a message is queued (or put back by "Send again"),
-- call the sender immediately. The per-minute job stays as a safety net and
-- still sends delayed messages (comments wait 2 min so several are combined)
-- and retries.
create or replace function private.wa_kick_now() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.wa_kick();   -- only calls the function when something is due now
  return null;
end $$;

create trigger whatsapp_outbox_kick after insert or update of status on public.whatsapp_outbox
  for each row when (new.status = 'queued' and new.send_after <= now())
  execute function private.wa_kick_now();

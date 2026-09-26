-- =====================================================================
-- WhatsApp Logs page: admins can send a failed / expired / skipped message
-- again. It goes back into the queue as a fresh message (the phone number
-- is read again from the profile, in case it was just added or fixed).
-- =====================================================================

create or replace function public.whatsapp_retry(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  o public.whatsapp_outbox;
  ph text;
begin
  if not private.is_admin() then raise exception 'Only admins can resend WhatsApp messages'; end if;
  select * into o from public.whatsapp_outbox where id = p_id for update;
  if not found then raise exception 'Message not found'; end if;
  if o.status not in ('failed', 'expired', 'skipped') then
    raise exception 'Only failed, expired or skipped messages can be sent again';
  end if;
  select private.wa_phone(phone) into ph from public.profiles where id = o.recipient_id and is_active;
  if ph is null then raise exception 'This person has no valid WhatsApp number (or is inactive). Add it in Users & Roles first.'; end if;

  update public.whatsapp_outbox set
    phone = ph, status = 'queued', attempts = 0, last_error = null,
    created_at = now(), send_after = now(), sent_at = null
  where id = p_id;
  return 'queued';
end $$;

revoke execute on function public.whatsapp_retry(uuid) from public, anon;
grant execute on function public.whatsapp_retry(uuid) to authenticated;

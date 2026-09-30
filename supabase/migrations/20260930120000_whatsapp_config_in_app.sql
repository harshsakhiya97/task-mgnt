-- =====================================================================
-- WATI connection set from the app (Settings → WhatsApp Logs), so nobody
-- has to open Supabase. The access token is kept encrypted in Supabase
-- Vault and can never be read back by the browser: admins can only set,
-- replace or remove it, and see its last 4 characters.
-- The Edge Function `whatsapp-sender` reads it with whatsapp_get_config()
-- (service role only). If nothing is saved here it falls back to the
-- WATI_TOKEN / WATI_API_URL Edge Function secrets.
-- =====================================================================

-- Admin: save the WATI API URL and/or token.
--   p_token: new token (null/empty = keep the current one)
--   p_api_url: WATI API endpoint (null = keep, '' = use the default)
--   p_clear_token: true = remove the saved token
create or replace function public.whatsapp_set_config(p_token text default null, p_api_url text default null, p_clear_token boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  tok text := nullif(btrim(regexp_replace(coalesce(p_token, ''), '^\s*bearer\s+', '', 'i')), '');
  url text := btrim(coalesce(p_api_url, ''));
  sid uuid;
begin
  if not private.is_admin() then raise exception 'Only admins can change the WhatsApp settings'; end if;

  if p_api_url is not null then
    if url = '' then
      delete from private.app_settings where key = 'wati_api_url';
    else
      url := regexp_replace(url, '/+$', '');
      if url !~* '^https://[a-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~/-]*)?$' then
        raise exception 'The API URL should look like https://live-mt-server.wati.io/123456 (WATI → API Docs)';
      end if;
      insert into private.app_settings (key, value) values ('wati_api_url', url)
        on conflict (key) do update set value = excluded.value;
    end if;
  end if;

  if p_clear_token then
    delete from vault.secrets where name = 'wati_token';
    delete from private.app_settings where key in ('wati_token_hint', 'wati_token_saved_at');
  elsif tok is not null then
    if length(tok) < 20 or tok ~ '\s' then raise exception 'That doesn''t look like a WATI access token. Copy it from WATI → API Docs.'; end if;
    select id into sid from vault.secrets where name = 'wati_token';
    if sid is null then
      perform vault.create_secret(tok, 'wati_token', 'WATI access token (set from Task Mgnt)');
    else
      perform vault.update_secret(sid, tok);
    end if;
    insert into private.app_settings (key, value) values
      ('wati_token_hint', right(tok, 4)), ('wati_token_saved_at', now()::text)
      on conflict (key) do update set value = excluded.value;
  end if;

  return public.whatsapp_config_status();
end $$;

-- Admin: what's saved (never the token itself).
create or replace function public.whatsapp_config_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Only admins can see the WhatsApp settings'; end if;
  return jsonb_build_object(
    'token_saved', exists (select 1 from vault.secrets where name = 'wati_token'),
    'token_hint', (select value from private.app_settings where key = 'wati_token_hint'),
    'token_saved_at', (select value from private.app_settings where key = 'wati_token_saved_at'),
    'api_url', (select value from private.app_settings where key = 'wati_api_url'));
end $$;

-- Edge Function only: the saved token and URL.
create or replace function public.whatsapp_get_config()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'token', (select decrypted_secret from vault.decrypted_secrets where name = 'wati_token' limit 1),
    'api_url', (select value from private.app_settings where key = 'wati_api_url'))
$$;

revoke all on function public.whatsapp_set_config(text, text, boolean) from public, anon;
revoke all on function public.whatsapp_config_status() from public, anon;
revoke all on function public.whatsapp_get_config() from public, anon, authenticated;
grant execute on function public.whatsapp_set_config(text, text, boolean) to authenticated;
grant execute on function public.whatsapp_config_status() to authenticated;
grant execute on function public.whatsapp_get_config() to service_role;

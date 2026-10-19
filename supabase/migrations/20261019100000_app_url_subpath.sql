-- The app moved to a sub-folder (https://pride.viralsakhiya.com/task): app_url may now include a path.
-- Links in WhatsApp / push / notifications are built as app_url || '/tasks?task=…'.
create or replace function public.sync_app_url(p_url text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  u text := rtrim(btrim(coalesce(p_url, '')), '/');
begin
  if not private.is_admin() then return private.setting('app_url'); end if;
  if u !~ '^https://[a-z0-9.-]+\.[a-z]{2,}(:[0-9]+)?(/[A-Za-z0-9._~-]+)*$' or u ~ '(localhost|127\.0\.0\.1|\.local(/|$)|\.test(/|$))' then
    return private.setting('app_url');
  end if;
  insert into private.app_settings (key, value) values ('app_url', u)
    on conflict (key) do update set value = excluded.value
    where private.app_settings.value is distinct from excluded.value;
  return u;
end $$;

revoke execute on function public.sync_app_url(text) from public, anon;
grant execute on function public.sync_app_url(text) to authenticated;

insert into private.app_settings (key, value) values ('app_url', 'https://pride.viralsakhiya.com/task')
  on conflict (key) do update set value = excluded.value;

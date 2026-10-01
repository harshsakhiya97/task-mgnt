-- "Send a test notification" (My Profile → Phone Notifications): queues a push to my own devices.
create or replace function public.push_test() returns int
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); n int;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select count(*) into n from public.push_subscriptions where user_id = me;
  if n = 0 then raise exception 'Phone notifications are not turned on on any of your devices yet'; end if;
  insert into public.push_outbox (user_id, title, body, url, tag)
  values (me, '⏰ Test reminder', 'Phone notifications are working. Reminders for your tasks will show up like this.', '/notifications?tab=reminders', 'test-' || me);
  perform private.push_kick();
  return n;
end $$;
revoke all on function public.push_test() from public, anon;
grant execute on function public.push_test() to authenticated;

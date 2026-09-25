-- =====================================================================
-- Remove the "Blocked" status. Statuses are now: To Do, In Progress, Done.
-- Tasks that were Blocked move to In Progress.
-- =====================================================================

update public.tasks set status = 'in_progress' where status = 'blocked';

create type public.task_status_new as enum ('todo', 'in_progress', 'done');
alter table public.tasks alter column status drop default;
alter table public.tasks alter column status type public.task_status_new using status::text::public.task_status_new;
alter table public.tasks alter column status set default 'todo';
drop type public.task_status;
alter type public.task_status_new rename to task_status;

create or replace function private.status_label(s text) returns text
language sql immutable set search_path = '' as $$
  select case s when 'todo' then 'To Do' when 'in_progress' then 'In Progress'
                when 'done' then 'Done' when 'blocked' then 'Blocked' else s end
$$;

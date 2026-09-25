-- =====================================================================
-- Log deleted comments and attachments in the task's Activity.
-- (Skipped when the whole task is being deleted.)
-- =====================================================================

create or replace function private.child_log_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.tasks where id = old.task_id) then
    return old;                                   -- task itself is being deleted
  end if;
  if tg_table_name = 'task_comments' then
    insert into public.task_activity (task_id, actor_id, action, old_value)
    values (old.task_id, coalesce((select auth.uid()), old.author_id), 'comment_deleted', left(old.body, 120));
  else
    insert into public.task_activity (task_id, actor_id, action, old_value)
    values (old.task_id, coalesce((select auth.uid()), old.uploaded_by), 'attachment_deleted', old.file_name);
  end if;
  return old;
end $$;

drop trigger if exists task_comments_log_delete on public.task_comments;
create trigger task_comments_log_delete after delete on public.task_comments
  for each row execute function private.child_log_delete();
drop trigger if exists task_attachments_log_delete on public.task_attachments;
create trigger task_attachments_log_delete after delete on public.task_attachments
  for each row execute function private.child_log_delete();

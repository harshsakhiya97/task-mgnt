-- 2.1 (owner, 2 Oct): no WhatsApp for "task assigned" and "comment" any more (phone notifications + bell cover them).
-- The triggers are disabled, not dropped. Undo:
--   alter table public.tasks enable trigger tasks_whatsapp;
--   alter table public.task_comments enable trigger task_comments_whatsapp;
alter table public.tasks disable trigger tasks_whatsapp;
alter table public.task_comments disable trigger task_comments_whatsapp;

-- Anything still waiting to go out is skipped.
update public.whatsapp_outbox set status = 'skipped', last_error = 'WhatsApp for new tasks/comments turned off'
 where kind in ('task_assigned', 'task_comment') and status in ('queued', 'sending');

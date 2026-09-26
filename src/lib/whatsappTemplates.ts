/**
 * The WhatsApp template texts, as approved in WATI (see docs/whatsapp-templates.md).
 * Used only to show a preview of each message on the WhatsApp Logs page —
 * WATI itself sends the approved text, filled with the same variables.
 */
export const WA_KIND_LABELS: Record<string, string> = {
  task_assigned: 'Task assigned',
  task_comment: 'New comment',
  daily_task_report: 'Day-end report',
}

const TEMPLATES: Record<string, string> = {
  task_assigned: `Hi {{name}},

You have a new task on Task Mgnt, assigned to you by {{assigner}}.

Task: {{task}}
Due: {{due}}

Please open the task to see the details, update its status and add comments: {{link}}

– Task Mgnt, Pride Educare`,
  task_comment: `Hi {{name}},

There is a new comment from {{commenter}} on a task you assigned.

Task: {{task}}
Comment: {{comment}}

You can read the full conversation and reply on Task Mgnt: {{link}}

– Task Mgnt, Pride Educare`,
  daily_task_report: `Hi {{name}}, here is the end-of-day task summary from Task Mgnt for {{date}}.

Tasks due today: {{total}}
Completed today: {{done}}
Expired (not done by the end time): {{expired}}
Still open for today: {{pending}}
Older tasks that are still not done: {{overdue}}

Open the full report with details for every person: {{link}}

– Task Mgnt, Pride Educare`,
}

/** The message as the person receives it. */
export function renderWhatsApp(kind: string, params: Record<string, unknown>): string {
  const tpl = TEMPLATES[kind]
  if (!tpl) return JSON.stringify(params, null, 2)
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (params[k] == null ? `{{${k}}}` : String(params[k])))
}

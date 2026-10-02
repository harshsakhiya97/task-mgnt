/**
 * The WhatsApp template texts, as approved in WATI (see docs/whatsapp-templates.md).
 * Used only to show each message on the WhatsApp pages (logs preview, Templates tab) —
 * WATI itself sends the approved text, filled with the same variables.
 */
export const WA_KIND_LABELS: Record<string, string> = {
  task_assigned: 'Task assigned',
  task_comment: 'New comment',
  daily_task_report: 'Day-end report',
  task_unassigned: 'User not found',
  task_reminder: 'Reminder',
}

export const WA_TEMPLATES: Record<string, string> = {
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
  task_unassigned: `Hi {{name}},

A task from Perisclaw has been added to the task list, but the person "{{person}}" was not found among the Task Mgnt users, so the task is not assigned to anyone yet.

Task: {{task}}

Please create the user to assign the task: {{link}}

– Task Mgnt, Pride Educare`,
  task_reminder: `Hi {{name}},

This is a reminder about a task on Task Mgnt.

Task: {{task}}
Due: {{due}}
Current status: {{status}}

Open the task to update it: {{link}}

– Task Mgnt, Pride Educare`,
}

/** The message as the person receives it. */
export function renderWhatsApp(kind: string, params: Record<string, unknown>): string {
  const tpl = WA_TEMPLATES[kind]
  if (!tpl) return JSON.stringify(params, null, 2)
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (params[k] == null ? `{{${k}}}` : String(params[k])))
}

/** When each template is sent (Settings → WhatsApp → Templates). */
export const WA_WHEN: Record<string, string> = {
  task_assigned: 'To the assignee when a task or recurring task is assigned or reassigned to them.',
  task_comment: 'To the assigner when the assignee comments. Comments within 2 minutes are sent as one message.',
  daily_task_report: 'To every active admin at 9:15 pm, with the day\'s task counts.',
  task_unassigned: 'To every active admin when a Perisclaw task names a person who isn\'t a user yet.',
  task_reminder: 'A task reminder: before the deadline or at a set time (automatic for urgent/high tasks, or set by hand). Not sent if the task is done.',
}

/** Example values (also the "sample values" WATI asks for when submitting a template). */
export const WA_SAMPLES: Record<string, Record<string, string>> = {
  task_assigned: { name: 'Ravi', assigner: 'Viral Sakhiya', task: 'TM-125 – Prepare TVS weekly report', due: '27-Sep-2026, 10:00 AM - 11:30 AM', link: 'https://pride.viralsakhiya.com/tasks?task=abc' },
  task_comment: { name: 'Viral Sakhiya', commenter: 'Ravi', task: 'TM-125 – Prepare TVS weekly report', comment: 'Done with the draft, please review', link: 'https://pride.viralsakhiya.com/tasks?task=abc' },
  daily_task_report: { name: 'Viral Sakhiya', date: '26-Sep-2026', total: '18', done: '14', expired: '3', pending: '1', overdue: '5', link: 'https://pride.viralsakhiya.com/reports' },
  task_unassigned: { name: 'Viral Sakhiya', person: 'Rahul Raja', task: 'TM-160 – Coordinate post-webinar automation', link: 'https://pride.viralsakhiya.com/tasks?task=abc' },
  task_reminder: { name: 'Ravi', task: 'TM-165 – Prepare TVS weekly report', due: '01-Oct-2026, 04:00 PM - 05:00 PM (in 2 hours)', status: 'In Progress', link: 'https://pride.viralsakhiya.com/tasks?task=abc' },
}

/** The templates the app sends today (shown in Settings → WhatsApp → Template Messages and checked in WATI).
 *  task_reminder is no longer sent: reminders are phone notifications since 1.4. */
/** Templates the app still sends (2.1: "task assigned" and "comment" are phone notifications + bell only). */
export const WA_ACTIVE_KINDS = ['daily_task_report', 'task_unassigned'] as const

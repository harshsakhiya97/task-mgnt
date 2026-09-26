# WhatsApp templates for WATI

Create these three templates in **WATI → Broadcast → Templates → New Template**.

- **Category:** Utility
- **Language:** English
- **Template name:** use exactly the name shown. The app sends to these names. If a name must differ, set the Edge Function secret `WATI_TEMPLATE_TASK_ASSIGNED` (or `..._TASK_COMMENT`, `..._DAILY_TASK_REPORT`) to your name.
- **Variables:** type them exactly as written, in double curly braces, e.g. `{{name}}`. WATI keeps named variables, and the app fills them by name.

When WATI asks for "sample values" for Meta's review, use the examples given under each template.

---

## 1. `task_assigned`
Goes to the assignee when a task, or a recurring task, is assigned or reassigned to them.

```
Hi {{name}},

{{assigner}} has assigned you a task on Task Mgnt.

Task: {{task_no}} – {{title}}
Due: {{due}}

Open the task: {{link}}
```
Samples: name = Ravi · assigner = Viral Sakhiya · task_no = TM-125 · title = Prepare TVS weekly report · due = 27-Sep-2026, 10:00 AM - 11:30 AM · link = https://pride.viralsakhiya.com/tasks?task=abc

For a recurring task: `task_no` = "Recurring" and `due` = "every Mon, Tue, Wed from 27-Sep-2026".

## 2. `task_comment`
Goes to the assigner when the assignee comments on the task. Several comments within 2 minutes arrive as one message, ending with "(+N more)".

```
Hi {{name}},

{{commenter}} commented on {{task_no}} – {{title}}:

"{{comment}}"

Reply here: {{link}}
```
Samples: name = Viral Sakhiya · commenter = Ravi · task_no = TM-125 · title = Prepare TVS weekly report · comment = Done with the draft, please review · link = https://pride.viralsakhiya.com/tasks?task=abc

## 3. `daily_task_report`
Goes to every active admin at **8:00 pm** each day. It counts the tasks due that day.

```
Hi {{name}}, here is today's task report ({{date}}).

Tasks due today: {{total}}
Completed: {{done}}
Expired: {{expired}}
Still open: {{pending}}
Older tasks still open: {{overdue}}

Full report: {{link}}
```
Samples: name = Viral Sakhiya · date = 26-Sep-2026 · total = 18 · done = 14 · expired = 3 · pending = 1 · overdue = 5 · link = https://pride.viralsakhiya.com/reports

---

### Rules the app follows
- **Phone numbers:** taken from each user's profile. 10-digit Indian numbers get `91` added. A user with no valid number is skipped, and System Check shows it.
- **Own actions:** nobody gets a message about their own action.
- **Recurring tasks:** the daily copies don't send anything.
- **Failed sends:** retried up to 5 times. A message still waiting after 24 hours is dropped, so no stale alerts go out.
- **Delivery log:** System Check → **WhatsApp messages**.

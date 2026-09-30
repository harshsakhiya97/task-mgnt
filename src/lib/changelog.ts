/**
 * "What's New" page content — written for users, newest version first.
 * (CHANGELOG.md is the technical version for developers.)
 *
 * On every release: bump "version" in package.json and add an entry at the TOP of this list.
 * `admin: true` marks features only admins can see (they still show for everyone, with an "Admin" tag).
 */
export type ChangeType = 'new' | 'improved' | 'fixed' | 'removed'
export interface Change { type: ChangeType; text: string; admin?: boolean }
export interface Release { version: string; date: string; title: string; summary: string; changes: Change[] }

export const RELEASES: Release[] = [
  {
    version: '1.2.3',
    date: '2026-09-30',
    title: 'Task numbers in the Perisclaw sheet',
    summary: 'Every row Perisclaw adds to the Google Sheet now shows the Task Mgnt task number it became, so edits always go to the right task.',
    changes: [
      { type: 'new', admin: true, text: 'The app writes each task\'s number (e.g. TM-165) into a "Task No" column in the Perisclaw sheet.' },
      { type: 'improved', admin: true, text: 'When Perisclaw edits a row that has a task number, that exact task is updated. Rows without a number become new tasks.' },
    ],
  },
  {
    version: '1.2.2',
    date: '2026-09-30',
    title: 'No duplicate tasks when Perisclaw edits a row',
    summary: 'Perisclaw sometimes corrects a task in the sheet after writing it. The app now updates the task it already made instead of adding a second one.',
    changes: [
      { type: 'improved', admin: true, text: 'A new Perisclaw row waits 2 minutes before it becomes a task, so a quick correction by Perisclaw is picked up first.' },
      { type: 'improved', text: 'When Perisclaw edits a task later, the existing task is updated (description, date, priority). If someone already changed the task by hand, the new details are added as a comment instead.' },
      { type: 'fixed', admin: true, text: 'Edited Perisclaw rows no longer create duplicate tasks or send the "user not found" message twice.' },
    ],
  },
  {
    version: '1.2.1',
    date: '2026-09-30',
    title: "What's New page",
    summary: 'See what changed in every version of Task Mgnt, right inside the app.',
    changes: [
      { type: 'new', text: 'This "What\'s New" page. Open it any time by clicking the version number at the bottom of the sidebar.' },
      { type: 'new', text: 'A small dot on the version number tells you when the app has been updated since you last looked.' },
      { type: 'improved', text: 'Notifications moved out of the sidebar: use the bell at the top right ("View all notifications" opens the full list).' },
      { type: 'improved', admin: true, text: 'Perisclaw and WhatsApp both have a "Sync now" button. On WhatsApp it sends any waiting messages straight away and reloads the list.' },
    ],
  },
  {
    version: '1.2',
    date: '2026-09-30',
    title: 'Tasks from Perisclaw and a new Settings area',
    summary: 'Give a task to Perisclaw on WhatsApp and it lands in Task Mgnt automatically. Admins get one Settings page for Perisclaw and WhatsApp.',
    changes: [
      { type: 'new', admin: true, text: 'Perisclaw → tasks: tasks you give Perisclaw on WhatsApp are added to a Google Sheet, and the app turns every new row into a task within 2 minutes.' },
      { type: 'new', admin: true, text: 'AI (Gemini) reads each row and picks out who the task is for, what it is, the date and time, and the priority.' },
      { type: 'new', text: 'Unassigned tasks: if a Perisclaw task names someone who isn\'t a user yet, the task is added without an assignee and shows an orange "Unassigned" badge until someone is assigned.' },
      { type: 'new', admin: true, text: 'Admins get a WhatsApp message and a notification when a task is added for a person who isn\'t a user yet, so they can create the user and assign the task.' },
      { type: 'new', admin: true, text: 'Perisclaw rows list: see every sheet row and what happened to it, add old rows as tasks, skip rows, or open the task that was created.' },
      { type: 'new', admin: true, text: 'Settings page in the sidebar, with Perisclaw and WhatsApp tabs.' },
      { type: 'new', admin: true, text: 'WhatsApp → Template Messages: every message the app sends, with an example and copy buttons to set it up in WATI.' },
      { type: 'new', admin: true, text: 'WhatsApp → Configuration: connect your WATI account from inside the app and check that it works.' },
      { type: 'improved', text: 'Task lists show the newest tasks first. In "Assigned to Me", tasks you haven\'t opened yet stay on top.' },
      { type: 'improved', text: 'Tasks with no assignee can be given to someone with the "Assign" button.' },
      { type: 'removed', admin: true, text: 'The System Check page (WhatsApp now has its own "Check connection").' },
    ],
  },
  {
    version: '1.1',
    date: '2026-09-26',
    title: 'Reports and WhatsApp alerts',
    summary: 'Team performance reports with Excel export, and WhatsApp messages for new tasks, comments and a daily summary.',
    changes: [
      { type: 'new', admin: true, text: 'Reports: pick a date range and team to see each person\'s assigned, completed, on-time, late, expired and pending tasks, with completion % and on-time %.' },
      { type: 'new', admin: true, text: 'Export Excel from Reports, with a summary sheet and a full task list.' },
      { type: 'new', text: 'WhatsApp message when a task is assigned or reassigned to you.' },
      { type: 'new', text: 'WhatsApp message when the person doing your task adds a comment (several quick comments come as one message).' },
      { type: 'new', admin: true, text: 'Day-end WhatsApp summary for admins every evening at 9:15 pm.' },
      { type: 'new', admin: true, text: 'WhatsApp Logs: every message the app sent, with filters, and resend for messages that failed.' },
      { type: 'fixed', text: 'Filter dropdowns no longer jump around when you change the selection.' },
    ],
  },
  {
    version: '1.0',
    date: '2026-09-25',
    title: 'First version of Task Mgnt',
    summary: 'Tasks, recurring tasks, calendar, dashboard and notifications for the Pride Educare team.',
    changes: [
      { type: 'new', text: 'Log in with email and password, with "Forgot password".' },
      { type: 'new', text: 'Tasks: give anyone a one-time task with a due date, time and priority. Status To Do, In Progress or Done, with Ongoing, Expired and Completed tags.' },
      { type: 'new', text: 'Recurring tasks: repeat a task on chosen days of the week; a copy appears automatically on each of those days.' },
      { type: 'new', text: 'Pass a task on to someone else with a handover note, and see the full history of who had it.' },
      { type: 'new', text: 'Comments, attachments and an activity log on every task.' },
      { type: 'new', text: 'Tasks page with Assigned to Me, Assigned by Me and Recurring tabs, count cards, filters and search.' },
      { type: 'new', text: 'Calendar with Day, Week and Month views. Drag tasks to move them, or drag on empty space to add one.' },
      { type: 'new', text: 'Dashboard with your day at a glance.' },
      { type: 'new', text: 'Notifications in the app (bell icon) when something happens on your tasks.' },
      { type: 'new', admin: true, text: 'Users & Roles: add users, set their role and team, reset passwords, and deactivate users.' },
      { type: 'new', admin: true, text: 'All Tasks view and the Company Overview on the dashboard.' },
    ],
  },
]

export const LATEST = RELEASES[0]

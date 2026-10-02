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
    version: '2.0.0',
    date: '2026-10-02',
    title: 'Reels',
    summary: 'A new task type for the reel editors: video title, caption, expected views and edit time, a Start / Pause / Stop edit timer, post links and view counts, plus a Reels report.',
    changes: [
      { type: 'removed', text: 'No more automatic reminders by priority: reminders are added only when you want one (+ Reminders in Add Task, or the task\'s Reminders tab). Settings → Reminders is gone. Reminders already on tasks stay.', admin: true },
      { type: 'improved', text: 'Add / Edit Task is wider (same as the task view) and shorter: just title, person, priority and due date. Description, time, reminders and attachments are added with the "+" buttons only when you need them.' },
      { type: 'new', text: 'Reels have a Sub-type (Podcast Editing, Reel / Short, Thumbnail Design, Shoot, Script Writing, Review / QC, …) picked in Add Task, and anyone on the reel (the editor too) can change it in the 🎬 Reel tab. It shows on the task list, the Team Board and in Reports → Reels.' },
      { type: 'new', text: 'Add Task → 🎬 Reel: video title, brief, caption, upload date (the day it should go up) and the edit due date. Reels have no reminders or attachments.' },
      { type: 'new', text: 'Only the editor sets the expected views and expected edit time (their own estimate), any time, in the reel\'s 🎬 Reel tab. Once the reel is Done, only an admin can change them.' },
      { type: 'new', text: 'Edit timer on the reel (Overview tab): the editor taps Start (the reel moves to In Progress), Pause for breaks, and Stop when editing is finished (it moves to Done). Every Start → Pause counts as a block of edit time. A timer left running is paused at 11:59 pm.' },
      { type: 'new', text: '🎬 Reel tab: caption (with Copy), Instagram, YouTube and Drive links, posted time, the actual views (one count, added about 24 hours after posting) and expected vs actual edit time.' },
      { type: 'new', text: 'Reels show a 🎬 Reel tag in the task list, and the Type filter has "Reels".' },
      { type: 'new', admin: true, text: 'Reports → Reels: expected vs actual views and expected vs actual edit time, per editor and per reel, with Excel export.' },
      { type: 'new', admin: true, text: 'Team Board: reels have a 🎬 tag, and "● Editing" shows whose edit timer is running right now.' },
    ],
  },
  {
    version: '1.5.4',
    date: '2026-10-01',
    title: 'iPhone form fix',
    summary: 'On iPhone, Add Task and Edit Task no longer slide sideways or zoom when you tap the date or time.',
    changes: [
      { type: 'fixed', text: 'iPhone: the date and time boxes fit the screen, so the Add / Edit Task form no longer slides sideways, and tapping a field no longer zooms in.' },
    ],
  },
  {
    version: '1.5.3',
    date: '2026-10-01',
    title: 'No zooming on phones',
    summary: 'The app no longer zooms in on phones (pinch or double-tap), so nothing gets pushed off the screen.',
    changes: [
      { type: 'improved', text: 'Phones and the installed app: pinch-to-zoom and double-tap zoom are turned off, so the menu and buttons always fit the screen. Scrolling works as before.' },
    ],
  },
  {
    version: '1.5.2',
    date: '2026-10-01',
    title: 'Small fixes',
    summary: 'A tidier "add reminder" line, and Settings → WhatsApp shows the right number of message templates.',
    changes: [
      { type: 'improved', text: 'Adding a reminder: who, how long, before/after the start or end, and Add sit side by side in one row (shorter labels on phones).' },
      { type: 'fixed', admin: true, text: 'Settings → WhatsApp: the Template Messages tab showed 5; it now shows 4, the number of templates the app actually sends.' },
    ],
  },
  {
    version: '1.5.1',
    date: '2026-10-01',
    title: 'Reminders before or after the start or end',
    summary: 'Reminders can now be set before or after a task\'s start or its end — for example "15 min before the start" or "30 min after the end". Admins also land on All Tasks.',
    changes: [
      { type: 'new', text: 'Reminders: choose before or after, and the start or the end of the task (e.g. "15 min before the start", "Right at the start", "30 min after the end").' },
      { type: 'new', text: 'Start-based reminders need the task to have a start time; without one they aren\'t sent (the form warns you).' },
      { type: 'new', admin: true, text: 'Settings → Reminders: each automatic reminder can also be before/after the start or the end.' },
      { type: 'improved', text: 'Task details are split into tabs: Overview (title and description, opens first), Details (people, dates, priority, status, time), Comments, Attachments, Reminders (with a count) and Activity.' },
      { type: 'improved', text: 'Phones: under a task\'s description there are "Show details" and Assign / Reassign buttons.' },
      { type: 'improved', admin: true, text: 'Tasks page: All Tasks is the first tab for admins and opens by default. Assigned to Me, Assigned by Me and Recurring are still one tap away.' },
    ],
  },
  {
    version: '1.5',
    date: '2026-10-01',
    title: 'Team Board',
    summary: 'A new board for admins showing everyone\'s tasks as cards, one column per person — and you can drag a task to someone else to reassign it.',
    changes: [
      { type: 'new', admin: true, text: 'Team Board (sidebar → Administration): every person\'s tasks as cards, with how many they have and how many they finished today (✓).' },
      { type: 'new', admin: true, text: 'Cards show the task number, priority, due date (red when overdue), planned time, and ▶ the time work started (when it was moved to In Progress).' },
      { type: 'new', admin: true, text: 'Filter by status (Open, To Do, In Progress, Done, All), due date (today & overdue, today, overdue, this week), team, or search.' },
      { type: 'new', admin: true, text: 'Drag a card onto another person to reassign it (on a computer), with Undo. Tasks without an assignee have their own "Unassigned" column to drag from.' },
      { type: 'new', admin: true, text: 'Click a person\'s name to open their own board: To Do, In Progress and Done (last 7 days) columns. Drag a card to another column to change its status.' },
    ],
  },
  {
    version: '1.4.2',
    date: '2026-10-01',
    title: 'iPhone menu fix',
    summary: 'On iPhone, the bottom of the side menu (your name and Log out) is no longer cut off.',
    changes: [
      { type: 'fixed', text: 'iPhone: the side menu fits the screen, so your name, Log out and the version are visible.' },
      { type: 'fixed', text: 'iPhone: buttons at the bottom of forms (Create Task, Update) stay clear of the home bar.' },
    ],
  },
  {
    version: '1.4.1',
    date: '2026-10-01',
    title: 'Phone notifications for new tasks and comments',
    summary: 'If you turned on phone notifications, you now also get one when a task is assigned to you and when someone comments on your tasks.',
    changes: [
      { type: 'new', text: 'Phone notification when a task is assigned (or passed on) to you. Tap it to open the task.' },
      { type: 'new', text: 'Phone notification for new comments on tasks you\'re part of. Several comments on one task show as one notification (the latest).' },
      { type: 'improved', text: 'WhatsApp messages and the bell for new tasks and comments work the same as before.' },
    ],
  },
  {
    version: '1.4',
    date: '2026-10-01',
    title: 'Reminders as phone notifications',
    summary: 'Reminders now pop up on your phone like any app notification — even when Task Mgnt is closed. Tap one to open the task.',
    changes: [
      { type: 'new', text: 'Phone notifications for reminders. Turn them on once: tap "Turn on" on the Dashboard, or go to My Profile → Phone Notifications.' },
      { type: 'new', text: 'Works on Android (Chrome, Edge, Samsung Internet) and computers. On iPhone (iOS 16.4 or newer), first add Task Mgnt to your home screen with "Download this app", then turn notifications on from the app.' },
      { type: 'new', text: '"Send a test notification" in My Profile → Phone Notifications, to check it works on your phone.' },
      { type: 'improved', text: 'Reminders now come as a phone notification and in Notifications → Reminders, instead of WhatsApp. New tasks and comments still come on WhatsApp and in Notifications.' },
      { type: 'improved', text: 'Logging out turns off reminder notifications on that device, so the next person doesn\'t get yours.' },
      { type: 'removed', admin: true, text: 'The WhatsApp "task_reminder" template is no longer needed (Settings → WhatsApp → Template Messages shows 4 templates).' },
    ],
  },
  {
    version: '1.3.2',
    date: '2026-10-01',
    title: 'Easier reminders and a better phone layout',
    summary: 'When you add an urgent or high priority task, its automatic reminders are listed in the form, so you can remove them or add more before saving.',
    changes: [
      { type: 'improved', text: 'Add Task shows the automatic reminders for the chosen priority as rows marked "Auto". Remove any you don\'t need, or add your own.' },
      { type: 'improved', text: 'Reminders say who they\'re for by name: "Remind me" or "Remind Sara".' },
      { type: 'improved', text: 'Edit Task shows the task\'s reminders too, so you can add or remove them there. Changing the priority shows its automatic reminders straight away.' },
      { type: 'improved', text: 'On a phone, tapping a count card (To Do, Expired, Due Today…) scrolls down to the list it filters.' },
      { type: 'new', text: 'Download this app: on a phone, add Task Mgnt to your home screen (button on the login page and in the menu). It then opens full screen like a normal app.' },
      { type: 'improved', text: 'Phones: tasks show as cards (number, priority, title, person, due date and status) instead of a wide table.' },
      { type: 'improved', text: 'Phones: smaller count cards, tabs and filters in one row you can swipe sideways.' },
      { type: 'improved', text: 'Phones: on the Calendar, Day / Week / Month is at the top, and Week view fits all seven days.' },
      { type: 'fixed', text: 'Phones: the close (×) button in a task\'s details no longer gets pushed off the screen.' },
    ],
  },
  {
    version: '1.3.1',
    date: '2026-10-01',
    title: 'Perisclaw task number fix',
    summary: 'A new Perisclaw task is no longer mixed up with an existing task when the sheet shows the wrong task number.',
    changes: [
      { type: 'fixed', admin: true, text: 'If Perisclaw writes a task number into the sheet on its own (for example one already used by a task made in the app), the row is now added as a new task and the sheet gets its correct number.' },
    ],
  },
  {
    version: '1.3',
    date: '2026-09-30',
    title: 'Reminders',
    summary: 'Get reminded about a task before its deadline, on WhatsApp and in the app. Urgent and high priority tasks get reminders automatically.',
    changes: [
      { type: 'new', text: 'Reminders on tasks: remind yourself (or, if you assigned the task, the assignee) 30 min to 1 day before the deadline, or at an exact time.' },
      { type: 'new', text: 'Reminders come on WhatsApp and as a notification, with the task\'s current status. They\'re not sent if the task is already done.' },
      { type: 'new', text: 'Add reminders while creating a task, or later in the task\'s details, where you can also see which were sent.' },
      { type: 'new', text: 'Urgent and high priority tasks get automatic reminders before their deadline.' },
      { type: 'new', admin: true, text: 'Settings → Reminders: choose the automatic reminders for each priority.' },
      { type: 'improved', text: 'The Notifications page has two tabs: Notifications (task updates) and Reminders, each with its own unread count and "Mark all as read".' },
      { type: 'improved', text: 'If a task has no time, its deadline for reminders is 7:00 pm on the due date. Recurring (daily routine) tasks don\'t get reminders.' },
    ],
  },
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

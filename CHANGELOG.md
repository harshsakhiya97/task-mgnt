# Changelog

The version shown in the app (sidebar footer and login page) comes from `"version"` in `package.json`.
To release a new version: bump it there, add a section below, add the user-facing entry at the top of `src/lib/changelog.ts` (the in-app "What's New" page), rebuild, then commit and tag (`git tag v1.2.1`).

## Version 2.2.0 — 3 Oct 2026

- **Meetings** (`tasks.kind = 'meeting'`). Organiser = creator (`assigned_to` = organiser). Add Task → 📅 Meeting: title, date, time (required), attendees (`AttendeePicker`, "Add everyone"), meeting link, "Remind everyone" (default 10 min before), agenda (= description), attachments.
- Tables `task_meetings` (meeting_link, notes, notes_updated_at/by, remind_minutes, reminded_at; row made by trigger `tasks_meeting_row`) and `task_attendees` (task_id, user_id, added_by; `response` column exists but is unused — owner: no RSVP). RLS: organiser/admin add/remove attendees and change link/reminder; anyone in the meeting edits notes. `tasks.participants` for meetings = organiser + attendees (recomputed in `tasks_before_write`); only the organiser/admin changes a meeting's status. `tasks.meeting_id` links action items to their meeting.
- Notifications: invite → bell + phone notification (type `meeting`, `notifications_push`). `tasks_notify` skips meetings. Cron `meeting-reminders` (every minute, `private.send_meeting_reminders()`) sends one bell + push to the organiser and all attendees. Cron `finish-ended-meetings` (every minute) marks a meeting Done at its end time.
- `report_by_person` and the WhatsApp day-end report exclude meetings; Team Board and Dashboard counts leave them out (Dashboard "Today" list shows today's meetings until they end).
- UI: TaskView Overview → meeting card (when, Join, organiser, attendee list; no Going / Can't make it — owner's call) + Agenda; new 📝 Notes tab (shared notes + action items; "+ Add action item" opens the normal Add Task form (TaskForm `actionFor` only sets `meeting_id`; recurring ones are not linked)). No Reminders tab / Reassign for meetings. Calendar: teal events, 📅 Meeting tag, "N people"; shows on every attendee's calendar (`isMine`). Type filter "Meetings", 📅 chip, bell icon.
- Migrations `20261003100000_meetings.sql`, `20261003110000_meetings_auto_done.sql`.

## Version 2.1.0 — 2 Oct 2026

- Copy task: `TaskTable` `onCopy` (Copy icon next to View) → `TaskForm copyFrom={task}` ("Copy TM-n"): new task prefilled with title, description, assignee, priority, due date (today if it was in the past), time; reels also sub-type, caption, upload date (dropped if past). Not copied: comments, attachments, reminders, timer, links, views. Recurring copies become one-time tasks.
- WhatsApp for task_assigned / task_comment turned off: triggers `tasks_whatsapp` and `task_comments_whatsapp` **disabled** (not dropped), queued rows skipped (migration `20261002200000_whatsapp_assigned_comment_off.sql`); `WA_ACTIVE_KINDS` = daily_task_report, task_unassigned. whatsapp-sender unchanged (nothing new of those kinds gets queued).
- Team Board status filter is a dropdown.
- Reports → Reels redone after the team's old "Results – Estimate vs Actual" panel: person filter, 7 count cards (Total / Estimate given / No estimate / Result in / Result pending / Uploaded / Not uploaded — pending & not-uploaded counted among estimated reels), a card per person (counts, 👁 actual / est with ▲▼ %, ⏱ time), click → modal with filter chips and the reel list (Upload badge, Estimated, Actual, ± %, Open). Excel export unchanged. Uploaded = posted_at or a link.
- Calendar events show the reel tag (`.ev-tag`, sub-type or "Reel"). Reel Edit Time Save only shown to the editor.

## Version 2.0.0 — 2 Oct 2026

- Task kinds: `tasks.kind` (`task` | `reel` | `meeting` — meeting reserved for 2.1). Add Task has One-time / Recurring / 🎬 Reel. Reels are one-time tasks.
- `task_reels` (1 row per reel, made by trigger `tasks_reel_row`): caption, instagram_url, youtube_url, posted_at (set on the first link), expected_views, expected_minutes. RLS: read/update if the user can see the task; trigger `task_reels_guard` lets only the creator / assigner / admin change the expected numbers.
- `reel_views`: manual counts per platform (`source` manual now, `auto` later for 2.3). "Views at 24 h" = the count closest to posted_at + 24 h within 18–48 h (`private.reel_views_24h`), Instagram + YouTube summed.
- `task_time_entries` + RPC `task_timer(task, 'start'|'pause'|'stop')`: start = assignee only (→ In Progress; pauses their other running timer; one running timer per person via a partial unique index); pause/stop = assignee or admin; stop → Done. Done or reassign stops running timers (trigger `tasks_stop_timers`). Cron `pause-running-timers` 29 18 * * * (23:59 IST). Manual blocks (own, finished, ≤ 24 h) and deleting own finished blocks allowed. Timer actions logged in `task_activity` (`timer`).
- RPC `report_reels(from, to, team)` (admin): per reel task due in range. Reports page has Tasks / Reels sub-tabs (`?view=reels`); Reels: stat cards, per-editor and per-reel tables, Excel export (Editors + Reels sheets).
- UI: TaskView Overview shows the timer card + caption for reels; new 🎬 Reel tab (Reel.tsx). Team Board shows 🎬 and "● Editing" (running timers). TASK_SELECT embeds `reel:task_reels(*)`.
- Migration `20261002100000_reels.sql`.
- Owner feedback: Add Task for reels has caption + **upload date** (`task_reels.upload_date`, creator/assigner/admin) and no reminders/attachments; expected views / edit time moved to the Reel tab ("Expected" section) — set by the editor (assignee), creator/assigner or admin; locked for non-admins once Done. Reels get no reminders: `task_reminders_before` silently skips automatic ones (trigger depth > 1) and refuses manual ones; open reminders on existing reels marked skipped. Reports → Reels shows Upload Date (read from task_reels) and flags posts after it. Migration `20261002110000_reels_editor_targets.sql`.
- One view count per reel: `task_reels.actual_views` (+ `views_counted_at` / `views_counted_by`, set by the guard trigger); the Reel tab has a single "Actual views" box instead of the count list. `report_reels` returns it as views_24h/latest_views (same signature); report labels say "Actual Views". `reel_views` kept, unused, for automatic counts later. Migration `20261002120000_reel_single_views.sql`.
- Expected views / edit time inputs moved into the Views and Edit Time sections of the Reel tab; the timer can't Start a reel until both are set (UI + `task_timer`). Migration `20261002130000_reel_start_needs_targets.sql`.
- Owner: expected views / edit time are the editor's own estimate — **only the assignee** sets them (not assigner/admin), and there's **no condition before Start** (reverted). The editor can change them any time (no locks). Migration `20261002140000_reel_targets_editor_only.sql`.
- **Automatic reminders removed**: `tasks_auto_reminders` is a no-op (migration `20261002170000_no_auto_reminders.sql`), Settings → Reminders tab + `ReminderSettings.tsx` removed, Add/Edit Task no longer shows Auto rows. `reminder_rules` table kept, unused; existing reminders untouched.
- Reel sub-type (`task_reels.sub_type`, list `REEL_SUB_TYPES` in lib/reels.ts, from the team's old app; no DB check so the list can change). Shown in chips, Overview, report + Excel. Migration `20261002190000_reel_sub_type.sql`.
- Reel: Drive link (`task_reels.drive_url`, migration `20261002180000_reel_drive_link.sql`); doesn't count as posting.
- Reel tab: Views and Edit Time are each two columns (expected | actual) with one Save; time-block list, Blocks count and manual "add time" removed from the UI. Caption no longer on the reel Overview.
- Add/Edit Task: `Drawer wide` (720px, like TaskView); optional sections (description/brief, caption, time, reminders, attachments) behind "+" chips (`form-extras`), open by default when editing a task that has them; 
- (Reel stages were added in 20261002150000 and reverted the same day in 20261002160000: timer Stop → Done again; `stage` / `upload_time` columns left unused.)

## Version 1.5.4 — 1 Oct 2026

- iPhone forms: native date/time inputs have an intrinsic min-width that made drawers wider than the screen (the form slid sideways — looked like zoom). Date/time inputs: `appearance: none`, `min-width: 0`, `max-width: 100%`; drawers clip horizontal overflow; html/body `overflow-x: clip` on phones; form fields 16px on phones (no focus-zoom on iOS).

## Version 1.5.3 — 1 Oct 2026

- No zoom on phones / installed app: viewport `maximum-scale=1, user-scalable=no`; `html { touch-action: pan-x pan-y }` + `touch-action: manipulation` on controls (no pinch / double-tap zoom); iOS `gesturestart`/`gesturechange` and multi-touch `touchmove` are cancelled (lib/install.ts), since iOS Safari ignores `user-scalable=no`.

## Version 1.5.2 — 1 Oct 2026

- Add-reminder line: 4 equal columns (who / amount / before-after start-end or date / Add). Phones: short labels ("Me", "2h", "before end", "Date…") via `useNarrow`, no dropdown arrows.
- Settings → WhatsApp: the Template Messages tab count was hard-coded to 5; it now uses `WA_ACTIVE_KINDS` (lib/whatsappTemplates.ts, 4 templates), shared with the template list.

## Version 1.5.1 — 1 Oct 2026

- **Reminders before/after the start or end.** `task_reminders.direction` (before/after) + `anchor` (start/end), `minutes_before` = amount (0 allowed = right at). Same per column in `reminder_rules` (`assignee_/assigner_direction`, `_anchor`). Start = start time on the due date (IST); no start time → start-based reminders are skipped ("Task has no start time") once the due date arrives, and re-opened if a start time is added (`tasks_reminders_recheck` now also watches `start_time`). New helpers `private.task_start`, `private.reminder_fire_at`, `private.human_rel`. "Before" reminders whose start/end already passed are skipped; "after" ones still send (unless done or >3 h late). Bell/push text: "starts at 10:00 AM (in 15 minutes)", "started at …", "is due …", "was due … (30 minutes ago)". Migration `20261001150000_reminder_anchor.sql`.
- Task details tabs: **Overview** (title + description, default) · Details (people, dates, type/priority/status, time) · Comments · Attachments · **Reminders** (moved out of Details; count; hidden for recurring copies) · Activity.
- Phones: Overview tab ends with **Show details** (→ Details tab) and **Assign / Reassign** buttons (`.ov-actions`, ≤ 800px).
- UI: reminder line = [who] [amount] [before/after the start/end] (or "At a date & time…"); warns when a start-based reminder is on a task without a start time. Settings → Reminders: amount + before/after-start/end per cell.
- Tasks page: for admins the default tab is **All Tasks**, shown first (All Tasks / Assigned to Me / Assigned by Me / Recurring). `?view=mine` now selects Assigned to Me explicitly; the default view has no `?view`.

## Version 1.5 — 1 Oct 2026

- **Team Board** (`/team-board`, admin, sidebar → Administration): one column per active user (+ "Unassigned" when there are such tasks), task cards (TM-no, priority, due date red when overdue, time range + length, ▶ started = latest `task_activity` status → `in_progress`, ✓ completed time), header counts (tasks shown, ✓ done today). Filters: status (Open default / To Do / In Progress / Done / All), due (any / today & overdue / today / overdue / this week), team, search. In Progress first, then by due date. Refreshes every minute.
- Click a person's name → their board (`/team-board?person=<id>`): To Do / In Progress / Done (completed in the last 7 days) columns, due filter + search, person picker, ✓ done today; drag between columns → `tasks.status` update with Undo (▶ started time appears right away).
- Drag & drop (desktop, HTML5 DnD) onto another person → `tasks.assigned_to` update (normal reassign rules, WhatsApp/bell/push as usual) with Undo toast. Phones: columns stack; tap → task details (Reassign there).
- No database changes.

## Version 1.4.2 — 1 Oct 2026

- iPhone: sidebar height uses `100dvh` (100vh includes the area under Safari's bars, which cut off the user box) + `env(safe-area-inset-bottom)`; drawers use `100dvh` and keep the footer buttons above the home bar.

## Version 1.4.1 — 1 Oct 2026

- **Phone notifications for new tasks and comments** (in addition to WhatsApp + bell). Trigger `notifications_push` on `notifications` insert (`20261001140000_push_tasks_comments.sql`): type `assigned` → push only to the task's current assignee (admins' "X assigned … to Y" bells don't push); type `comment` → push to everyone who gets the comment bell. Only queued for people with a device registered. Tag per task (`comment-<task>` / `assigned-<task>`), so newer replaces older; `renotify` in `sw.js`.
- Texts in My Profile → Phone Notifications and the prompts now mention reminders, new tasks and comments.

## Version 1.4 — 1 Oct 2026

- **Reminders as phone notifications (Web Push)** instead of WhatsApp. Reminders now go to: the bell (Notifications → Reminders) + a push notification on every device where the person turned them on. Task assigned / comments / unassigned / day-end report stay on WhatsApp + bell.
  - Turn on: Dashboard banner, Notifications → Reminders banner, or My Profile → **Phone Notifications** (status, turn off, "Send a test notification"). iPhone: only in the installed app (iOS 16.4+); the card explains and offers "Download this app". Blocked permission → how to unblock.
  - Tapping a notification opens the task (`public/sw.js`: `push` + `notificationclick`). Badge icon `public/icons/badge-96.png`.
  - Logging out removes this device's subscription. The app re-saves its subscription on load (`syncPush`).
- Database (`20261001120000_web_push.sql`, `20261001130000_push_test.sql`): tables `push_subscriptions` (own rows via RLS; `push_subscribe()` upserts by endpoint) and `push_outbox` (admin read); `push_claim_batch` / `push_mark` (service role); `push_public_key()`; VAPID keys made once by the function (private key in Vault `vapid_private_key`, public in `private.app_settings.vapid_public_key`); `private.push_kick()` + cron `push-sender` every minute; `push_test()`. `send_due_reminders()` now queues push instead of WhatsApp `task_reminder`.
- New Edge Function **`push-sender`** (v1, verify_jwt off): VAPID (ES256) + aes128gcm encryption with WebCrypto only (`webpush.ts`, checked against the `http_ece` reference implementation). Removes devices that are gone (404/410); retries 429/5xx up to 3 times; messages older than 3 h expire.
- whatsapp-sender v11: "Check connection" checks 4 templates (no `task_reminder`). Template Messages tab shows 4.

## Version 1.3.2 — 1 Oct 2026

- **Add Task → Reminders:** the automatic reminders for the chosen priority (Settings → Reminders, e.g. Urgent: assignee 2 hrs + you 1 hr before) now appear as rows marked **Auto**. Remove any with ×, or add more. Changing the priority shows that priority's reminders again. The database still adds them on insert; the ones removed in the form are deleted right after the task is saved.
- Reminder labels use names: "Remind me" / "Remind Sara" (form dropdown, rows and task details).
- **Edit Task** shows the task's reminders (`TaskReminders`, saved straight away); changing the priority previews the new priority's Auto rows (old pending Auto ones hidden); ones removed in the form are deleted after Update.
- **Mobile:** tapping a count card scrolls to the list below it (`StatCard`, ≤ 800px).
- **Installable app (PWA):** `public/manifest.json`, icons in `public/icons/`, `public/sw.js` (no caching — always loads the latest version; offline page for navigations). "Download this app" (`InstallApp`) on the login page and in the sidebar on phones: uses the browser's install prompt (`beforeinstallprompt`, Android Chrome/Edge/Samsung) or shows Add-to-Home-Screen steps (iPhone Safari / when no prompt). Hidden when already opened as the app.
- **Mobile layout pass (≤ 800px), checked page by page at 375px:**
  - Task lists (Tasks, Dashboard) render as cards (`.task-table` grid areas); compact count cards (icon beside the number).
  - View tabs, filters, task-detail tabs and settings sub-tabs are single rows that scroll sideways.
  - Calendar: Day/Week/Month switch on top (own segmented control), short titles, two-line week headers, ‹ Month Year › in Month view, max 2 events per day.
  - Task details header: number + × on row 1, Reassign/Edit/Delete on row 2. Top bar hides the breadcrumb under 560px.

## Version 1.3.1 — 1 Oct 2026

- **Perisclaw — wrong Task No in the sheet:** Perisclaw sometimes fills the "Task No" column itself (it guessed `TM-173` for a new row, a number already used by a task made in the app). The app treated that row as an edit of TM-173 and added it as a comment, so the new task was never created. Now a Task No in the sheet is only trusted if the app itself linked that task to a Perisclaw row; otherwise the row is a new task and its Task No cell is overwritten with the real number.
- Data fix: removed the wrong comment from TM-173; the row became TM-177.
- perisclaw-sync v14.

## Version 1.3 — 30 Sep 2026

- **Reminders on tasks:**
  - Remind **yourself** or **the assignee** 30 min, 1/2/3/4 hrs or 1 day **before the deadline**, or at an exact date & time. "Before the deadline" reminders move with the task if its date or time changes.
  - Deadline = the task's end time, or **7:00 pm** if it has no time.
  - Set them in **Add Task** (Reminders section) or later in the task's details (list with Sent / Pending / Not sent, add and remove).
  - Sent on **WhatsApp** (new template `task_reminder`) and as a bell notification; **not sent if the task is already Done**. Recurring tasks don't have reminders.
  - Who can set what: anyone who can see a task can remind themselves; the assigner, the creator or an admin can also remind the assignee.
- **Notifications page:** two tabs, **Notifications** (task updates) and **Reminders**, each with its own unread count, All/Unread filter and "Mark all as read" (the bell still shows everything).
- If a task's date, time, status or assignee changes, reminders that were skipped (e.g. "added too close to the deadline") are checked again against the new deadline. Skipped reminders show the reason next to "Not sent".
- **Automatic reminders by priority** (Settings → **Reminders**, admins): default **Urgent** → assignee 2 hrs + assigner 1 hr before; **High** → assignee 2 hrs before; Medium/Low → none. Added to every new one-time task (also from Perisclaw); changing a task's priority swaps its automatic reminders.
- Database: tables `task_reminders`, `reminder_rules`; job `task-reminders` every minute (`private.send_due_reminders`). whatsapp-sender v9 (checks the new template too).

## Version 1.2.3 — 30 Sep 2026

- **Perisclaw — task numbers in the Google Sheet:** once a row becomes a task, the app writes its number (e.g. `TM-165`) into a **Task No** column (added automatically if missing). When a row with a task number is edited later, that exact task is updated (if it's still the same task); rows without one become new tasks. Rows that already had tasks get their numbers on the next sync. The Task No column is ignored when comparing rows, so writing it doesn't count as an edit.
- Needs the robot account to be an **Editor** of the sheet (was Viewer). Until then everything else keeps working and the Perisclaw page shows a note.
- perisclaw-sync v13 (Sheets scope now read + write).

## Version 1.2.2 — 30 Sep 2026

- **Perisclaw — no more duplicate tasks when Perisclaw edits a row:**
  - A new sheet row waits 2 minutes before it becomes a task (status "Waiting 2 min"). If Perisclaw corrects the row during the wait, only the corrected version is added.
  - If Perisclaw edits a row later (e.g. adds a point 20 minutes after), the app recognises it's the same task (same title, or mostly the same text) and **updates the existing task** instead of creating a new one. Only fields nobody has changed by hand are updated (description, due date, priority, time); if someone already edited the description, the new details are added as a comment on the task.
  - If a row is reused for a completely different task, a new task is created as before.
  - An edited row doesn't send the "user not found" WhatsApp message again.
- perisclaw-sync v12; migrations `20260930130000_perisclaw_wait`, `20260930140000_perisclaw_edit_no_realert`.

## Version 1.2.1 — 30 Sep 2026

- **What's New page** (everyone): click the version number in the sidebar footer to see every version with its date, summary and New / Improved / Fixed / Removed points in plain language. Admin-only features are listed for everyone with an "Admin" tag; admins can switch to "What team members see".
- A small red dot on the version number when the app has been updated since this browser last opened What's New.
- The version label now shows the patch number when it isn't 0 (e.g. "Version 1.2.1").
- Sidebar: **Notifications** item removed; the bell (top right) and its "View all notifications" link remain.
- **Sync now** on both Settings tabs: Perisclaw reads the sheet; WhatsApp sends waiting messages now and reloads the log (was "Refresh").

## Version 1.2 — 30 Sep 2026

- **Perisclaw → tasks** (Settings → Perisclaw): give Perisclaw a task on WhatsApp; it adds a row to a Google Sheet and the app turns it into a task.
  - The sheet stays private: the app reads it as a Google "robot" (service account) that the sheet is shared with as Viewer.
  - New rows are read every 2 minutes (or **Sync now**). Gemini (AI) picks out the person, task, date/time and priority; descriptions keep their line breaks.
  - Every row becomes a task straight away; the admin can edit it later. No date or a past date → due today.
  - **Person not a user yet → the task is added Unassigned**, and every admin gets the new WhatsApp message `task_unassigned` plus a bell notification to create the user and assign it.
  - Rows table with count cards (All, Added as Task, Unassigned, Waiting for You, Skipped, Errors) and an **Action** column: **Add as task** (AI pre-fills the form; Regenerate / Clear AI), **Skip**, and the task number (e.g. TM-156) that opens the task.
  - Rows that were already in the sheet when it was connected are not added automatically.
  - Gemini busy (error 503/429): automatic retries, a lighter backup model, and up to 5 tries on later runs.
  - Deleting a task that came from a row marks the row as Skipped.
  - Setup guide: `docs/perisclaw.md`.
- **Unassigned tasks:** orange **Unassigned** badge in task lists, **Assign** button, and editing keeps the task unassigned until someone is picked. Only the system or an admin can leave a task unassigned.
- **Settings** (admin, one sidebar item) with tabs:
  - **Perisclaw:** Sheet Rows / Configuration.
  - **WhatsApp:** WhatsApp Logs / Template Messages (each template with its text, an example, sample values, WATI approval status and copy buttons) / Configuration.
- **WATI connection from the app:** save the WATI access token and API URL in Settings → WhatsApp → Configuration (stored encrypted in Supabase Vault, never shown again), with **Check connection**. No Supabase access needed.
- **Tasks list:** newest tasks first (unopened "New" tasks stay on top in Assigned to Me).
- **Removed:** the System Check page and the test `hello` function.

## Version 1.1 — 26 Sep 2026

- **Reports** (admin, new sidebar item): pick a date range (Today / This Week / This Month / Last Month / Custom) and a team. Shows per-person Assigned, Completed, On time, Late, Expired and Pending, plus Completion % and On-time %, with totals. **Export Excel** downloads a Summary sheet and a Tasks sheet.
- **WhatsApp via WATI:**
  - Task assigned or reassigned → message to the assignee.
  - Assignee comments → message to the assigner. Comments within 2 minutes are combined.
  - Day-end report → admins at 9:15 pm every day.
  - Messages go through a queue with retries. Sending starts once the WATI secrets are set. Templates are in `docs/whatsapp-templates.md`.
- **WhatsApp Logs** (admin, new sidebar item): every message with date range, type and status filters, search, and count cards. Click a message to see exactly what was sent. Failed, expired or skipped messages can be sent again.
- **System Check:** "WhatsApp sender" connection test.
- **Automatic deploy:** pushing the `deploy` branch builds and uploads to cPanel (GitHub Actions).
- **Fix:** page-header and filter dropdowns no longer jump around when the selection changes.

## Version 1.0 — 25 Sep 2026

First complete version of Task Mgnt (AI Execution OS) for Pride Educare.

- **Login**: email + password (Supabase Auth); forgot / reset password.
- **Users & Roles** (admin): Users, Roles (master – only the built-in Admin role has admin access) and Teams (master) tabs; create users, set role/team, reset password, deactivate/reactivate.
- **Tasks**: Ad hoc (due date) and Recurring (chosen weekdays, start/end date) tasks; statuses To Do / In Progress / Done; Ongoing / Expired / Completed tags (Expired after the task's end time on its due date); priority; reassign (delegation chain); "New" badge; comments, attachments and activity log; delete (creator/admin).
- **Tasks page**: Assigned to Me / Assigned by Me / All Tasks (admin) / Recurring tabs in the search row; clickable count cards; filters, search and pagination.
- **Recurring tasks**: a copy is created for each chosen day at 00:05 IST (pg_cron, retry at 06:05); pause / resume / edit / delete; time changes ask "Only this date / Every day".
- **Calendar**: Day / Week (Sun–Sat) / Month views with month & year pickers; admin sees all users; drag to move/resize; click or drag on empty space to add a task; dashed cards for upcoming recurring days; count cards for the period on screen.
- **Dashboard**: My Day, Assigned by Me and Company Overview (admin) counts; today & expired list.
- **Notifications**: in-app, real-time (bell + Notifications page).
- **Stack**: React + Vite (static build on cPanel) · Supabase (Postgres + RLS, Auth, Storage, Edge Functions `admin-users` & `setup-admin`, pg_cron).

# Changelog

The version shown in the app (sidebar footer and login page) comes from `"version"` in `package.json`.
To release a new version: bump it there, add a section below, add the user-facing entry at the top of `src/lib/changelog.ts` (the in-app "What's New" page), rebuild, then commit and tag (`git tag v1.2.1`).

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

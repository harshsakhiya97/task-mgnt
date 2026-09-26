# Changelog

The version shown in the app (sidebar footer and login page) comes from `"version"` in `package.json`.
To release a new version: bump it there, add a section below, rebuild, then commit and tag (`git tag v1.1`).

## Version 1.1 — 26 Sep 2026

- **Reports** (admin, new sidebar item): pick a date range (Today / This Week / This Month / Last Month / Custom) and a team. Shows per-person Assigned, Completed, On time, Late, Expired and Pending, plus Completion % and On-time %, with totals. **Export Excel** downloads a Summary sheet and a Tasks sheet.
- **WhatsApp via WATI:**
  - Task assigned or reassigned → message to the assignee.
  - Assignee comments → message to the assigner. Comments within 2 minutes are combined.
  - Day-end report → admins at 8:00 pm.
  - Messages go through a queue with retries. Sending starts once the WATI secrets are set. Templates are in `docs/whatsapp-templates.md`.
- **System Check:** "WhatsApp sender" test and a log of the last 50 messages.
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

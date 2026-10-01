# Task Mgnt (AI Execution OS) — project handover

Internal task & execution app for **Pride Educare**. Owner: Viral Sakhiya · Maintainer: Harsh Sakhiya.
Pilot: TVS team (≈7 users), then the whole company (16–20).
**Current version: 1.5 (1.5.0)**, released 1 Oct 2026. Live at **https://pride.viralsakhiya.com**.

---

## 1. Stack & where things run

| Part | Where |
|---|---|
| Frontend: React 18 + Vite 5 + TypeScript, react-router 6, FullCalendar 6, lucide-react, write-excel-file | Static build (`dist/`) on **cPanel** shared hosting |
| Database (Postgres + RLS), Auth (email + password), Storage, Edge Functions (Deno), pg_cron, pg_net, Vault | **Supabase** project `tazlvzjalhxsudceabqy` ("Pride") |
| WhatsApp messages | **WATI** (template messages), called from the `whatsapp-sender` Edge Function |
| Phone notifications (reminders, new tasks, comments) | **Web Push** (VAPID, no third-party service), sent by the `push-sender` Edge Function |
| AI (Perisclaw rows → tasks) | **Google Gemini** `gemini-2.5-flash` (backup `gemini-2.5-flash-lite`), from `perisclaw-sync` |
| Google Sheet access | Google **service account** ("robot"), Sheets API read + write |

No custom backend server: all logic is in Postgres (triggers, RLS, security-definer functions in schema `private`) and 5 Edge Functions.
The app is an installable PWA (`public/manifest.json`, `public/sw.js`, icons in `public/icons/`).

Frontend env (build time): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. `__APP_VERSION__` is injected from `package.json` by Vite.

---

## 2. Repo layout

```
src/
  App.tsx                routes
  auth/AuthProvider.tsx  session + profile (profile.role: 'admin' | 'manager' | 'team_member')
  components/            Layout (sidebar/topbar), TaskForm, TaskView (details/comments/attachments/activity),
                         TaskTable, ReassignForm, Recurring*, Reminders, WatiConnection, WaTemplates,
                         SubTabs (+ useSubView ?view=), CopyButton, AssigneeName, Drawer, Fields, StatCard, Pagination …
  lib/                   supabase client, tasks.ts (types, TASK_SELECT, helpers), reminders.ts, whatsappTemplates.ts
                         (template texts/samples for previews), changelog.ts (What's New content), version.ts, adminApi.ts
  notifications/         NotificationsProvider (realtime + poll), NotificationBell, NotificationIcon
  pages/                 Home (dashboard), Tasks, Calendar, Notifications, TeamBoard, Reports, Users (Users/Roles/Teams tabs),
                         Settings (tabs: Perisclaw, WhatsApp, Reminders), Perisclaw, WhatsAppLogs, ReminderSettings,
                         WhatsNew, Profile, Login, ForgotPassword, ResetPassword, Setup
  index.css              all styles (plain CSS, design tokens as CSS vars)
supabase/
  migrations/            34 SQL files, applied in order (timestamps 20260925… → 20261001140000)
  functions/             admin-users, setup-admin, perisclaw-sync (index.ts, lib.ts, google.ts), whatsapp-sender, push-sender (index.ts, webpush.ts)
docs/                    perisclaw.md (setup guide), whatsapp-templates.md (all WATI templates)
.github/workflows/deploy.yml   build + FTP deploy to cPanel
CHANGELOG.md             technical changelog;  src/lib/changelog.ts = user-facing "What's New"
```

Build: `npm run build` (= `tsc -b && vite build`). Dev: `npm run dev` (localhost:5173).

---

## 3. Features (by version)

**1.0 (25 Sep 2026)** — Login (email/password, forgot/reset). Users & Roles (admin): Users, Roles (master; `roles.is_admin`), Teams (master). Tasks: ad hoc (due date, optional start/end time) and recurring (weekdays, start/end date; a copy is generated per day at 00:05 IST). Statuses To Do / In Progress / Done (+ Blocked in DB); tags Ongoing / Expired / Completed (Expired = past end time on due date). Priority low/medium/high/urgent. Reassign (delegation chain via `participants`), "New" badge (`seen_at`), comments, attachments (bucket `task-files`), activity log, delete (creator/admin). Tasks page tabs: Assigned to Me / Assigned by Me / All Tasks (admin) / Recurring; count cards, filters, search, pagination; newest first. Calendar (day/week/month, drag to move/resize, drag empty space to add). Dashboard. In-app notifications (bell).

**1.1 (26 Sep)** — Reports (admin; per-person assigned/completed/on-time/late/expired/pending, Excel export via RPC `report_by_person`). WhatsApp via WATI: task assigned/reassigned → assignee; assignee comment → assigner (2-min batching); day-end report → admins 21:15 IST. WhatsApp Logs with resend. Auto-deploy via GitHub Actions.

**1.2 (30 Sep)** — **Perisclaw** (WhatsApp AI assistant that writes tasks into a Google Sheet) → tasks (see §6). **Unassigned tasks** (`tasks.assigned_to` nullable; only system/admin may leave it empty; orange badge, "Assign" button). **Settings** page (admin) with tabs. **WATI token/API URL set from the app** (Supabase Vault). Template Messages tab with copy buttons. System Check page and `hello` function removed.

**1.2.1** — What's New page (`/whats-new`, sidebar version label + red dot until seen), "Sync now" on Settings tabs, Notifications removed from sidebar (bell stays).
**1.2.2** — Perisclaw: 2-minute wait for new rows; later edits of the same row update the existing task (no duplicates).
**1.2.3** — Perisclaw: app writes `TM-…` into a "Task No" column in the sheet and uses it to match edits (robot must be **Editor**).

**1.3 (30 Sep)** — **Reminders** (see §7). Notifications page split into **Notifications** / **Reminders** tabs.
**1.3.1 (1 Oct)** — Perisclaw: a Task No in the sheet is trusted only if the app linked that task to a Perisclaw row (Perisclaw sometimes writes its own guess); otherwise the row is a new task and the cell is corrected.
**1.3.2 (1 Oct)** — Add/Edit Task list the priority's automatic reminders as removable "Auto" rows (removed ones are deleted after save via `dropAutoReminders`); reminder labels by name ("Remind me" / "Remind Sara"). Mobile-first layout pass (task cards, compact count cards, scrolling tabs/filters, calendar view switch on top). Installable app (PWA) + "Download this app" on phones.

**1.4 (1 Oct)** — **Reminders as phone notifications** (Web Push) + Notifications → Reminders tab, **no longer WhatsApp**. Turn on: Dashboard / Reminders-tab banner or My Profile → Phone Notifications (test button). iPhone needs the installed app (iOS 16.4+). Task assigned / comments stay WhatsApp + bell.
**1.4.1 (1 Oct)** — Phone notifications also for "task assigned to you" and comments (trigger `notifications_push` on `notifications`), on top of WhatsApp + bell.
**1.4.2 (1 Oct)** — iPhone: sidebar/drawers use `100dvh` + safe-area padding (user box was cut off).

**1.5 (1 Oct)** — **Team Board** (admin, `/team-board`, `pages/TeamBoard.tsx`): a column per person with task cards (▶ started time from `task_activity`, ✓ done today), filters (status/due/team/search), drag a card onto another person to reassign (Undo). Click a name → that person's status board (`?person=id`: To Do / In Progress / Done last 7 days; drag between columns to change status).

---

## 4. Database (schema `public`, RLS on everything)

Tables: `profiles` (full_name, phone, email, role enum + `role_id` → `roles`, team_id, is_active), `roles`, `teams`, `tasks`, `recurring_tasks`, `task_comments`, `task_attachments`, `task_activity`, `notifications`, `whatsapp_outbox`, `perisclaw_settings` (single row id=1), `perisclaw_entries`, `task_reminders`, `reminder_rules`, `push_subscriptions` (one per device; own rows), `push_outbox`, `health_check` (legacy).

Key `tasks` columns: `task_no` (shown as `TM-<n>`), title, description, `assigned_by`, `assigned_to` (nullable), `created_by`, `participants uuid[]` (drives RLS read/update), due_date, start_time, end_time, priority, status, task_type (`adhoc`/`recurring`), `recurring_id`, `occurrence_date`, `seen_at`, `reassigned`, `completed_at`.

Important triggers on `tasks`: `tasks_before_write` (permission rules, participants, assignment bookkeeping, active-user check), `tasks_notify` (bell), `tasks_whatsapp` (WhatsApp task_assigned), `tasks_log_activity`, `tasks_occurrence_defaults`, `tasks_auto_reminders`, `tasks_reminders_recheck`.
Other: `notifications_push` (assigned→assignee / comment → push_outbox), `task_comments_whatsapp`, `whatsapp_outbox_kick` (instant send via pg_net), `perisclaw_entries_guard`, `perisclaw_unassigned_alert`, `task_reminders_before`, `profiles_role_sync`, `roles_guard`.

Helpers in schema `private` (security definer): `is_admin()`, `can_see_task()`, `person_name()`, `active_admins()`, `today_ist()`, `task_deadline()`, `reminder_deadline()` (end time or 19:00 IST), `setting(key)` (from `private.app_settings`, e.g. `app_url`), `wa_enqueue()`, `wa_text()`, `wa_due_text()`, `notify()`, `send_due_reminders()`, `perisclaw_kick()`, `wa_kick()`.
Public RPCs: `report_by_person`, `plan_recurring_day`, `sync_app_url` (admin; keeps `app_url` in sync with where admins open the app, ignores localhost), `whatsapp_claim_batch` / `whatsapp_mark` (service role), `whatsapp_retry` (admin), `whatsapp_set_config` / `whatsapp_config_status` (admin), `whatsapp_get_config` (service role only), `push_subscribe` / `push_public_key` / `push_test` (users), `push_claim_batch` / `push_mark` / `push_get_keys` / `push_set_keys` (service role). VAPID keys: private in Vault `vapid_private_key`, public in `private.app_settings.vapid_public_key` (created once by push-sender; never replace — devices are tied to it).

pg_cron jobs (UTC): `generate-recurring-tasks` 35 18 * * * (00:05 IST) + retry 35 0 * * *; `whatsapp-sender` every minute; `whatsapp-daily-report` 45 15 * * * (21:15 IST); `perisclaw-sync` every 2 min; `task-reminders` every minute; `push-sender` every minute (`private.push_kick()`; reminders also kick it instantly).

Timezone: everything user-facing is IST (Asia/Kolkata).

---

## 5. Edge Functions

| Function | verify_jwt | Purpose |
|---|---|---|
| `admin-users` | on | Admin user management (create/update/set_active/set_password); checks caller is admin via `roles.is_admin` |
| `setup-admin` | off | One-time "create first admin" for an empty install; refuses once any user exists. Keep it. |
| `whatsapp-sender` (v11) | off | Sends queued `whatsapp_outbox` rows via WATI `sendTemplateMessage`; token from Vault (`whatsapp_get_config`) or `WATI_TOKEN` secret fallback; `{action:'check'}` (admin JWT) tests the token and returns each template's WATI approval status |
| `perisclaw-sync` (v14) | off | Reads the Perisclaw sheet, Gemini parsing, creates/updates tasks, writes Task No back; `{action:'status'|'parse'|'clear'}` |
| `push-sender` (v1) | off | Sends queued `push_outbox` rows as Web Push (index.ts + webpush.ts: VAPID ES256 + aes128gcm with WebCrypto); removes gone devices (404/410), retries 429/5xx ×3, expires after 3 h; makes the VAPID keys on first run |

Secrets (Supabase → Edge Functions → Secrets; values never in code/chat): `GEMINI_API_KEY`, optional `GEMINI_MODEL`, `GOOGLE_SERVICE_ACCOUNT_JSON`, optional `WATI_TOKEN` / `WATI_API_URL` (fallback only — the token is saved in the app; the old `WATI_TOKEN` secret was deleted 1 Oct), optional `WATI_TEMPLATE_<KIND>` name overrides.
Deploying functions: files are uploaded whole (index.ts + lib.ts + google.ts for perisclaw-sync). Type-check first with `deno check`.

---

## 6. Perisclaw flow (Settings → Perisclaw)

1. Admin gives Perisclaw a task on WhatsApp → Perisclaw adds a row to a Google Sheet (private; shared with the robot `pride-task-mgnt@pride-task-mgnt.iam.gserviceaccount.com` as **Editor**).
2. Every 2 min `perisclaw-sync` reads the sheet (tab from the link's gid). Rows are identified by a SHA-256 of their content, **excluding the "Task No" column**.
3. New row → entry `waiting` for ~2 min (Perisclaw often corrects a row right after writing). An edited waiting version replaces the old one.
4. Gemini returns assignee (by number from the active users list), title, description (line breaks kept), due date, times, priority, confidence. `decide()`: every row becomes a task; unknown person → **unassigned** + WhatsApp `task_unassigned` + bell to all admins; no/past date → today; "by 5 pm" → 16:00–17:00.
5. Edited later: row's Task No (or same row number + `sameTaskRow` title/text similarity) → update the existing task's untouched fields (description/date/priority/time) or add a comment if a human edited it. Different task in the same row → new task.
6. After creating/linking, the app writes `TM-<n>` into the sheet's "Task No" column (adds the header if missing).
7. Gemini busy (429/5xx): retry, backup model, then up to 5 tries on later runs.
Rows already in the sheet when it's first connected are `skipped_existing` (Add as task manually). Admin actions on the rows page: Add as task (AI pre-fill, Regenerate/Clear AI), Skip; deleting a task marks its row Skipped. Full guide: `docs/perisclaw.md`.

---

## 7. Reminders (1.3)

`task_reminders`: target `assignee` (whoever holds the task at send time) or `person` (+`person_id`); either `minutes_before` the deadline (moves with the task) or fixed `remind_at`; `auto`, `sent_at`, `skipped` (reason).
Deadline = due date + end time, or **7:00 pm IST** if no time. Recurring tasks: no reminders.
`reminder_rules` (Settings → Reminders, admin): defaults **urgent** = assignee 120 min + assigner 60 min; **high** = assignee 120 min; medium/low none. Added on task insert and swapped on priority change (assigner rule skipped for self-tasks).
Who may add: anyone who can see the task → for themselves; assigner/creator/admin → also for the assignee/others.
`send_due_reminders()` (every minute): bell type `reminder` + `push_outbox` row (phone notification; since 1.4 no WhatsApp); skipped if done, no assignee, deadline passed, auto reminder already past when the task was created, or >3 h late. `tasks_reminders_recheck` re-opens skipped reminders when date/time/status/assignee change.

---

## 8. WhatsApp (WATI) templates

Kinds / template names (all Utility, English, named `{{variables}}`, each ends with "– Task Mgnt, Pride Educare"; full texts + samples in `docs/whatsapp-templates.md` and in-app Settings → WhatsApp → Template Messages):
`task_assigned` (name, assigner, task, due, link) · `task_comment` (name, commenter, task, comment, link) · `daily_task_report` (name, date, total, done, expired, pending, overdue, link) · `task_unassigned` (name, person, task, link). (`task_reminder` no longer used since 1.4 — reminders are phone notifications.)
`{{task}}` = "TM-125 – title". `{{link}}` built from `app_url` setting. Outbox: retries up to 5, expires after 24 h; phone numbers from profiles (10-digit → +91).
**Status 1 Oct:** all four approved.

---

## 9. Deploy & git workflow (follow this)

- Work on a feature branch (e.g. `v1.3-reminders`) or `main`. Commit author: Harsh Sakhiya <harshsakhiya97@gmail.com>.
- **Deploy only when the owner says "deploy"**: merge into `main`, then fast-forward `deploy` and push → GitHub Actions (`deploy.yml`) builds with Node 20 and uploads changed files to cPanel over FTPS (secrets `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
- Database migrations and Edge Functions are applied/deployed directly to Supabase when built (they're live before the frontend deploy — keep frontend and DB compatible).
- **Every release:** bump `package.json` (+ lockfile) version, add a section to `CHANGELOG.md`, add a user-facing entry at the top of `src/lib/changelog.ts` (What's New; `admin: true` for admin-only items), tag `vX.Y(.Z)`. Version label shows `major.minor` plus patch when ≠ 0.
- Owner's Mac repo: `/Users/harshsakhiya/Documents/Projects/Task Mgnt/Repo` (on `main`, tags v1.0 … v1.3 local).
- Working style: discuss first when the owner is exploring an idea; build when they say start/go. Test DB changes with rollback blocks; verify live behaviour; don't paste or ask for secrets in chat (owner adds them in Supabase/GitHub or in the app).

---

## 10. Known follow-ups / ideas

- Future ideas mentioned: Google Calendar/Meet via an organiser Gmail account (Pride has no Google Workspace), custom SMTP for auth emails, leaked-password protection, reminders on recurring tasks (explicitly out of scope for now).
- Perisclaw edits made after a task exists are matched by Task No / row number; if Perisclaw inserts rows above old ones, row-number matching (for rows without Task No) can miss.

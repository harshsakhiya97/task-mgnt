# Task Mgnt

Internal task & execution app for Pride Educare.
React (Vite + TypeScript) frontend on cPanel, Supabase for database, login and server functions.

| Part | Runs on |
|---|---|
| React frontend (`dist/`) | cPanel shared hosting (static files) |
| Database, login (email + password), permissions (RLS) | Supabase |
| Edge Functions (`supabase/functions`) | Supabase |
| WhatsApp notifications (later) | Wati, called from Edge Functions |

## What's built

**Step 1 – Users, roles & login**
- Email + password login, forgot / reset password by email, change password from profile
- Roles: Admin, Manager, Team member
- Admin pages: **Users** (add, edit, change role/team, set password, deactivate/reactivate) and **Teams**
- Every user can see the user list (so anyone can assign to anyone later); only admins can change roles, teams or status
- Admin-only **System check** page at `/health`

## Supabase setup (one time)

1. **Run the SQL** – Dashboard → SQL Editor → paste and run
   `supabase/migrations/20260925100000_users_roles.sql`
   (the older `…_health_check.sql` was only for the deploy test).
2. **Deploy the Edge Function** – Dashboard → Edge Functions → Deploy a new function →
   name `admin-users` → paste `supabase/functions/admin-users/index.ts` → Deploy.
   (CLI: `supabase functions deploy admin-users`)
3. **Turn off public sign-ups** – Authentication → Sign In / Providers → Email →
   disable "Allow new users to sign up". Admins create all accounts.
4. **Set URLs** (for reset-password emails) – Authentication → URL Configuration:
   - Site URL: `https://pride.viralsakhiya.com`
   - Redirect URLs: `https://pride.viralsakhiya.com/**` and `http://localhost:5173/**`
5. **Create the first admin (you)** – easiest: open the app while no users exist; it shows a
   one-time **"Create the first admin account"** screen (Edge Function `setup-admin`,
   deployed with JWT verification off; it refuses all requests once any user exists).
   Manual alternative:
   - Authentication → Users → Add user → Create new user → your email + password,
     tick **Auto Confirm User**.
   - SQL Editor → run (with your email):
     ```sql
     insert into public.profiles (id, full_name, email, role)
     select id, 'Harsh', email, 'admin' from auth.users
     where email = 'you@example.com'
     on conflict (id) do update set role = 'admin', is_active = true;
     ```
   - Log in to the app. Every other user is added from the **Users** page.

## Run locally

```bash
cp .env.example .env      # Supabase URL + publishable/anon key
npm install               # run on your own machine
npm run dev               # http://localhost:5173
```

## Deploy to cPanel

```bash
npm run build             # creates dist/ (.env values are baked in)
```

Upload the **contents** of `dist/` (including the hidden `.htaccess`) to the domain's
document root. Files must be **644**, folders **755** — a 403 Forbidden means wrong
permissions or no `index.html` in the root.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Account not set up" after login | No row in `profiles` for that login — create users from the Users page, or run the first-admin SQL. |
| "Only admins can manage users" | Your profile's role isn't `admin`. |
| Add user fails with "Failed to send a request" | `admin-users` function not deployed. |
| Reset email link opens the wrong site | Fix Site URL / Redirect URLs (setup step 4). |
| Refresh on a page gives 404 | `.htaccess` missing or `mod_rewrite` disabled. |
| Blank page | Uploaded the `dist` folder instead of its contents, or `.env` empty at build time. |

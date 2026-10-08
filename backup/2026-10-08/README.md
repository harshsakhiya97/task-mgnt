# Supabase backup — 8 Oct 2026

Project `tazlvzjalhxsudceabqy` ("Pride"), app version 2.3, last migration `20261005100000_whatsapp_pause`.

| File | What |
|---|---|
| `schema.sql` | Every migration from `supabase/migrations`, in order: tables, RLS, functions, triggers, cron jobs. |
| `data.sql` | All rows of every `public` table, plus users (`auth.users` / `auth.identities` without password hashes), `private.app_settings` and sequence positions. |

## Restore into a new Supabase project
1. SQL editor → run `schema.sql`.
2. SQL editor → run `data.sql` (triggers are off while it loads, so no notifications / WhatsApp / push fire).
3. Users sign in with **Forgot password** (password hashes are not in the backup).
4. Re-add secrets: WATI token (app → Settings → WhatsApp), Edge Function secrets `GEMINI_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`.
5. Deploy the 5 Edge Functions from `supabase/functions`. `push-sender` creates new VAPID keys, so everyone turns phone notifications on again.
6. Point the frontend at the new project (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` GitHub secrets) and deploy.

**Not included:** password hashes, Vault secrets (WATI token, VAPID private key), Storage files (7 attachments, ~0.75 MB — listed at the end of `data.sql`).
WhatsApp was paused (`whatsapp_paused = on`) when this was taken.

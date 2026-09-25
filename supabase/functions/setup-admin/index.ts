// Supabase Edge Function: one-time creation of the FIRST admin.
// Works only while no user exists yet; after that it refuses every request.
//
//   POST { action: "status" }                              -> { needsSetup: boolean }
//   POST { action: "create", full_name, email, password }  -> { ok: true }
//
// Deployed with verify_jwt = false (nobody is logged in yet).
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  const needsSetup = async () => {
    const { count, error } = await admin.from('profiles').select('id', { count: 'exact', head: true })
    if (error) throw error
    const { data: users, error: uErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 })
    if (uErr) throw uErr
    return (count ?? 0) === 0 && users.users.length === 0
  }

  try {
    const body = await req.json().catch(() => ({}))

    if (body.action === 'status') return json({ needsSetup: await needsSetup() })

    if (body.action === 'create') {
      if (!(await needsSetup())) return json({ error: 'Setup is already complete. Please log in.' }, 403)

      const full_name = String(body.full_name ?? '').trim()
      const email = String(body.email ?? '').trim().toLowerCase()
      const password = String(body.password ?? '')
      if (!full_name) return json({ error: 'Name is required' }, 400)
      if (!email.includes('@')) return json({ error: 'Valid email is required' }, 400)
      if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400)

      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name },
      })
      if (error) return json({ error: error.message }, 400)

      const { error: pErr } = await admin.from('profiles').insert({ id: data.user.id, email, full_name, role: 'admin' })
      if (pErr) {
        await admin.auth.admin.deleteUser(data.user.id)
        return json({ error: pErr.message }, 400)
      }
      return json({ ok: true })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

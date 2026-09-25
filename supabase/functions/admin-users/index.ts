// Supabase Edge Function: admin-only user management.
// Creating logins, changing roles/teams and (de)activating users needs the
// service-role key, which must never be in the browser — so it lives here.
//
// Deploy:  supabase functions deploy admin-users
//   (or Dashboard -> Edge Functions -> Deploy new function "admin-users", paste this file)
//
// Actions (POST JSON body):
//   { action: "create", email, password, full_name, phone?, role_id, team_id? }
//   { action: "update", id, full_name?, phone?, role_id?, team_id?, email? }
//   { action: "set_active", id, active }
//   { action: "set_password", id, password }
// Roles come from the public.roles master list; only the built-in Admin role
// (is_admin) gives admin access.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

function need(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new HttpError(400, msg)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

    // 1. Who is calling? Must be a logged-in, active admin.
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: userData, error: userErr } = await admin.auth.getUser(token)
    if (userErr || !userData.user) throw new HttpError(401, 'Not logged in')
    const callerId = userData.user.id

    const { data: caller } = await admin
      .from('profiles').select('role, is_active').eq('id', callerId).single()
    if (!caller || caller.role !== 'admin' || !caller.is_active) {
      throw new HttpError(403, 'Only admins can manage users')
    }

    const body = await req.json().catch(() => ({}))
    const action = body.action as string

    // Older app builds send the legacy enum `role` instead of `role_id`; translate it.
    const LEGACY: Record<string, string> = { admin: 'Admin', manager: 'Manager', team_member: 'Team Member' }
    if (body.role_id === undefined && typeof body.role === 'string' && LEGACY[body.role]) {
      const { data } = await admin.from('roles').select('id').eq('name', LEGACY[body.role]).maybeSingle()
      if (data) body.role_id = data.id
    }

    /** Look up a role from the master list; returns whether it gives admin access. */
    const roleIsAdmin = async (roleId: unknown): Promise<boolean> => {
      need(typeof roleId === 'string' && roleId, 'Role is required')
      const { data } = await admin.from('roles').select('is_admin').eq('id', roleId).maybeSingle()
      if (!data) throw new HttpError(400, 'Invalid role')
      return data.is_admin
    }

    // 2. Do the requested action.
    if (action === 'create') {
      const email = String(body.email ?? '').trim().toLowerCase()
      const full_name = String(body.full_name ?? '').trim()
      need(email.includes('@'), 'Valid email is required')
      need(full_name, 'Name is required')
      need(String(body.password ?? '').length >= 8, 'Password must be at least 8 characters')
      await roleIsAdmin(body.role_id)

      const { data: created, error } = await admin.auth.admin.createUser({
        email, password: body.password, email_confirm: true,
        user_metadata: { full_name },
      })
      if (error) throw new HttpError(400, error.message)

      const { error: pErr } = await admin.from('profiles').insert({
        id: created.user.id, email, full_name,
        phone: body.phone || null, role_id: body.role_id, team_id: body.team_id || null,
      })
      if (pErr) {
        await admin.auth.admin.deleteUser(created.user.id) // keep things consistent
        throw new HttpError(400, pErr.message)
      }
      return json({ ok: true, id: created.user.id })
    }

    need(typeof body.id === 'string' && body.id, 'User id is required')
    const isSelf = body.id === callerId

    if (action === 'update') {
      const patch: Record<string, unknown> = {}
      if (body.full_name !== undefined) { need(String(body.full_name).trim(), 'Name is required'); patch.full_name = String(body.full_name).trim() }
      if (body.phone !== undefined) patch.phone = body.phone || null
      if (body.team_id !== undefined) patch.team_id = body.team_id || null
      if (body.role_id !== undefined) {
        const toAdmin = await roleIsAdmin(body.role_id)
        need(!(isSelf && !toAdmin), 'You cannot remove your own admin role')
        patch.role_id = body.role_id
      }
      if (body.email !== undefined) {
        const email = String(body.email).trim().toLowerCase()
        need(email.includes('@'), 'Valid email is required')
        const { error } = await admin.auth.admin.updateUserById(body.id, { email, email_confirm: true })
        if (error) throw new HttpError(400, error.message)
        patch.email = email
      }
      const { error } = await admin.from('profiles').update(patch).eq('id', body.id)
      if (error) throw new HttpError(400, error.message)
      return json({ ok: true })
    }

    if (action === 'set_active') {
      need(!isSelf, 'You cannot deactivate yourself')
      const active = Boolean(body.active)
      // A banned user cannot log in or refresh their session.
      const { error } = await admin.auth.admin.updateUserById(body.id, {
        ban_duration: active ? 'none' : '876000h',
      })
      if (error) throw new HttpError(400, error.message)
      const { error: pErr } = await admin.from('profiles').update({ is_active: active }).eq('id', body.id)
      if (pErr) throw new HttpError(400, pErr.message)
      return json({ ok: true })
    }

    if (action === 'set_password') {
      need(String(body.password ?? '').length >= 8, 'Password must be at least 8 characters')
      const { error } = await admin.auth.admin.updateUserById(body.id, { password: body.password })
      if (error) throw new HttpError(400, error.message)
      return json({ ok: true })
    }

    throw new HttpError(400, `Unknown action "${action}"`)
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500
    return json({ error: e instanceof Error ? e.message : String(e) }, status)
  }
})

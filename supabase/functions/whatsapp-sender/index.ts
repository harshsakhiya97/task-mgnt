// Supabase Edge Function: sends queued WhatsApp messages through WATI.
// Called every minute by pg_cron (private.wa_kick) while messages are waiting.
// It takes no input and only works through public.whatsapp_outbox, so calling it
// early does no harm (deployed with verify_jwt off for the cron call).
//
// WATI connection: set by an admin in the app (Settings → WhatsApp → Configuration).
// The token is kept encrypted in Supabase Vault and read here with whatsapp_get_config().
// Fallback when nothing is saved in the app (Supabase → Edge Functions → Secrets):
//   WATI_API_URL   optional — defaults to Pride's WATI endpoint below (WATI → API Docs)
//   WATI_TOKEN     the access token from WATI → API Docs ("Bearer …" is fine too)
//   POST {"action":"check"} (admin only) -> is the token working, and are the templates approved?
// Optional, if your WATI template names differ from the defaults:
//   WATI_TEMPLATE_TASK_ASSIGNED, WATI_TEMPLATE_TASK_COMMENT, WATI_TEMPLATE_DAILY_TASK_REPORT, WATI_TEMPLATE_TASK_UNASSIGNED, WATI_TEMPLATE_TASK_REMINDER
import { createClient } from 'npm:@supabase/supabase-js@2'

interface Outbox {
  id: string
  kind: 'task_assigned' | 'task_comment' | 'daily_task_report' | 'task_unassigned' | 'task_reminder'
  phone: string | null
  template: string
  params: Record<string, unknown>
}

// Pride's WATI API endpoint (not secret). A WATI_API_URL secret overrides it.
const DEFAULT_WATI_API_URL = 'https://live-mt-server.wati.io/10103863'

const KINDS: Outbox['kind'][] = ['task_assigned', 'task_comment', 'daily_task_report', 'task_unassigned', 'task_reminder']
const INTERNAL_PARAMS = new Set(['more_count'])

// Allows "Check connection" (Settings → WhatsApp → Configuration) to call this from the browser.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: cors })

function templateName(row: Pick<Outbox, 'kind' | 'template'>) {
  return Deno.env.get(`WATI_TEMPLATE_${row.kind.toUpperCase()}`) || row.template
}
const authHeader = (token: string) => token.toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}`

/** Admin "Check connection": can we reach WATI with this token, and which of our templates exist / are approved? */
async function checkWati(apiUrl: string, token: string) {
  const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/api/v1/getMessageTemplates?pageSize=500&pageNumber=1`, {
    headers: { Authorization: authHeader(token) },
  })
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try { body = JSON.parse(text) } catch { /* not JSON */ }
  if (!res.ok) {
    return { ok: false, error: res.status === 401 || res.status === 403
      ? 'WATI refused the token. Copy a fresh one from WATI → API Docs.'
      : `WATI ${res.status}: ${String(body.message ?? body.info ?? text).slice(0, 200) || 'no answer'}` }
  }
  const list = (body.messageTemplates ?? []) as { elementName?: string; status?: string }[]
  const templates = KINDS.map((kind) => {
    const name = templateName({ kind, template: kind })
    const t = list.find((x) => x.elementName === name)
    return { kind, name, status: t ? String(t.status ?? 'unknown').toUpperCase() : 'MISSING' }
  })
  return { ok: true, templates }
}

async function sendOne(row: Outbox, apiUrl: string, token: string): Promise<{ ok: boolean; error?: string }> {
  const parameters = Object.entries(row.params)
    .filter(([k]) => !INTERNAL_PARAMS.has(k))
    .map(([name, value]) => ({ name, value: String(value ?? '') }))
  const url = `${apiUrl.replace(/\/+$/, '')}/api/v1/sendTemplateMessage?whatsappNumber=${encodeURIComponent(row.phone ?? '')}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader(token),
      },
      body: JSON.stringify({ template_name: templateName(row), broadcast_name: `task_mgnt_${row.kind}`, parameters }),
    })
    const text = await res.text()
    let body: Record<string, unknown> = {}
    try { body = JSON.parse(text) } catch { /* not JSON */ }
    if (!res.ok || body.result === false) {
      const info = (body.info ?? body.message ?? text) as string
      return { ok: false, error: `WATI ${res.status}: ${String(info).slice(0, 300)}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const input = await req.json().catch(() => ({}))
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  // Saved in the app first, then the Edge Function secrets.
  const { data: cfg } = await db.rpc('whatsapp_get_config')
  const apiUrl = (cfg?.api_url as string | null) || Deno.env.get('WATI_API_URL') || DEFAULT_WATI_API_URL
  const token = (cfg?.token as string | null) || Deno.env.get('WATI_TOKEN') || ''
  const source = cfg?.token ? 'app' : token ? 'supabase-secret' : null

  if (input?.action === 'check') {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: u } = await db.auth.getUser(jwt)
    const { data: me } = u?.user
      ? await db.from('profiles').select('is_active, role_info:roles(is_admin)').eq('id', u.user.id).maybeSingle()
      : { data: null }
    const who = me as unknown as { is_active: boolean; role_info: { is_admin: boolean } | null } | null
    if (!who?.is_active || !who.role_info?.is_admin) return reply({ error: 'Only admins can do this' }, 403)
    if (!token) return reply({ configured: false, source, api_url: apiUrl, error: 'No WATI access token saved yet.' })
    const result = await checkWati(apiUrl, token).catch((e) => ({ ok: false, error: `Can't reach WATI: ${e instanceof Error ? e.message : e}` }))
    return reply({ configured: true, source, api_url: apiUrl, ...result })
  }

  if (!token) {
    return reply({ configured: false, message: 'Add the WATI access token in the app: Settings → WhatsApp → Configuration.' })
  }

  const { data, error } = await db.rpc('whatsapp_claim_batch', { p_limit: 20 })
  if (error) return reply({ error: error.message }, 500)

  let sent = 0, failed = 0
  for (const row of (data ?? []) as Outbox[]) {
    const r = await sendOne(row, apiUrl, token)
    await db.rpc('whatsapp_mark', { p_id: row.id, p_ok: r.ok, p_error: r.error ?? null })
    if (r.ok) sent++; else failed++
  }
  return reply({ configured: true, source, sent, failed })
})

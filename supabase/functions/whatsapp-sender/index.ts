// Supabase Edge Function: sends queued WhatsApp messages through WATI.
// Called every minute by pg_cron (private.wa_kick) while messages are waiting.
// It takes no input and only works through public.whatsapp_outbox, so calling it
// early does no harm (deployed with verify_jwt off for the cron call).
//
// Secrets (Supabase dashboard → Edge Functions → Secrets):
//   WATI_API_URL   e.g. https://live-mt-server.wati.io/123456   (WATI → API Docs)
//   WATI_TOKEN     the access token from WATI → API Docs ("Bearer …" is fine too)
// Optional, if your WATI template names differ from the defaults:
//   WATI_TEMPLATE_TASK_ASSIGNED, WATI_TEMPLATE_TASK_COMMENT, WATI_TEMPLATE_DAILY_TASK_REPORT
import { createClient } from 'npm:@supabase/supabase-js@2'

interface Outbox {
  id: string
  kind: 'task_assigned' | 'task_comment' | 'daily_task_report'
  phone: string | null
  template: string
  params: Record<string, unknown>
}

const INTERNAL_PARAMS = new Set(['more_count'])

// Allows the "WhatsApp sender" test on the System Check page to call this from the browser.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: cors })

function templateName(row: Outbox) {
  return Deno.env.get(`WATI_TEMPLATE_${row.kind.toUpperCase()}`) || row.template
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
        Authorization: token.toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}`,
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
  const apiUrl = Deno.env.get('WATI_API_URL')
  const token = Deno.env.get('WATI_TOKEN')
  if (!apiUrl || !token) {
    return reply({ configured: false, message: 'Set WATI_API_URL and WATI_TOKEN in the function secrets.' })
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  const { data, error } = await db.rpc('whatsapp_claim_batch', { p_limit: 20 })
  if (error) return reply({ error: error.message }, 500)

  let sent = 0, failed = 0
  for (const row of (data ?? []) as Outbox[]) {
    const r = await sendOne(row, apiUrl, token)
    await db.rpc('whatsapp_mark', { p_id: row.id, p_ok: r.ok, p_error: r.error ?? null })
    if (r.ok) sent++; else failed++
  }
  return reply({ configured: true, sent, failed })
})

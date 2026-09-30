// Supabase Edge Function: reads new rows from the Perisclaw Google Sheet, asks Gemini
// to pick out assignee / task / date-time / priority, and creates the tasks.
// Unclear rows are saved as "needs_review" for an admin to finish on the Perisclaw page.
//
// Called every 2 minutes by pg_cron (private.perisclaw_kick) while it's switched on,
// and by the "Sync now" button. It takes no input and only acts on the configured
// sheet, so an extra call does no harm (verify_jwt off for the cron call).
//   POST {}                  -> check the sheet now
//   POST {"action":"status"} -> { gemini: true/false, robot } (is the key set? robot email)
//   POST {"action":"parse"|"clear", entry_id} -> admin only, see below
//
// Secrets (Supabase → Edge Functions → Secrets):
//   GEMINI_API_KEY   free key from https://aistudio.google.com → Get API key
//   GEMINI_MODEL     optional, default gemini-2.5-flash
//   GOOGLE_SERVICE_ACCOUNT_JSON  the robot account's JSON key; the sheet is shared with its email as Viewer.
//                    Without it the sheet must be shared as "anyone with the link can view".
import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildPrompt, decide, GEMINI_SCHEMA, nowInIndia, rowKey, sha256, sheetRows, valuesToRows, type AiResult, type Person, type SheetRow } from './lib.ts'
import { readServiceAccount, readSheetValues } from './google.ts'

const MAX_ROWS_PER_RUN = 8          // stays well inside Gemini's free-tier rate limit
const MAX_TRIES = 5                 // a row Gemini was too busy for is tried again on later runs, up to this many times
const BACKUP_MODEL = 'gemini-2.5-flash-lite'
const BUSY_PREFIX = 'Gemini is busy'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: cors })

/** Gemini said "busy / too many requests / server error": worth trying again later. */
class GeminiBusy extends Error { constructor(public status: number) { super(`${BUSY_PREFIX} right now (${status})`) } }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function callGemini(model: string, prompt: string, key: string): Promise<AiResult> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA },
    }),
  })
  const body = await res.json().catch(() => ({}))
  if ([429, 500, 502, 503, 504].includes(res.status)) throw new GeminiBusy(res.status)
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${body?.error?.message ?? 'request failed'}`)
  const text = body?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? ''
  try { return JSON.parse(text) as AiResult } catch { throw new Error('Gemini returned something that is not JSON') }
}

/** Main model, once more after a short wait if it's busy, then the lighter backup model. */
async function askGemini(prompt: string, key: string): Promise<AiResult> {
  const main = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash'
  const plan = main === BACKUP_MODEL ? [main, main] : [main, main, BACKUP_MODEL]
  let last: unknown
  for (let i = 0; i < plan.length; i++) {
    try { return await callGemini(plan[i], prompt, key) } catch (e) {
      last = e
      if (!(e instanceof GeminiBusy)) throw e
      if (i < plan.length - 1) await sleep(2000)
    }
  }
  throw last
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const input = await req.json().catch(() => ({}))
  const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? ''
  const sa = readServiceAccount()
  if (input?.action === 'status') return reply({ gemini: !!geminiKey, robot: sa?.client_email ?? null })

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  // Admin-only row actions from the Perisclaw page (the caller's login is checked):
  //   {action:'parse', entry_id} -> (re)read one row with Gemini and save what it understood; creates nothing
  //   {action:'clear', entry_id} -> forget what Gemini understood for that row
  if (input?.action === 'parse' || input?.action === 'clear') {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: u } = await db.auth.getUser(token)
    const { data: me } = u?.user
      ? await db.from('profiles').select('is_active, role_info:roles(is_admin)').eq('id', u.user.id).maybeSingle()
      : { data: null }
    const who = me as unknown as { is_active: boolean; role_info: { is_admin: boolean } | null } | null
    if (!who?.is_active || !who.role_info?.is_admin) return reply({ error: 'Only admins can do this' }, 403)
    const { data: entry } = await db.from('perisclaw_entries').select('id, row_number, raw, raw_text, status').eq('id', String(input.entry_id ?? '')).maybeSingle()
    if (!entry) return reply({ error: 'Row not found' }, 404)
    if (entry.status === 'created' || entry.status === 'processing') return reply({ error: 'This row is already a task' }, 400)
    if (input.action === 'clear') {
      await db.from('perisclaw_entries').update({ parsed: null }).eq('id', entry.id)
      return reply({ parsed: null })
    }
    if (!geminiKey) return reply({ error: 'Add the GEMINI_API_KEY secret first' }, 400)
    const { data: ppl } = await db.from('profiles').select('id, full_name, team:teams(name), role_info:roles(name)').eq('is_active', true).order('full_name')
    const people: Person[] = ((ppl ?? []) as unknown as { id: string; full_name: string; team: { name: string } | null; role_info: { name: string } | null }[])
      .map((p) => ({ id: p.id, full_name: p.full_name, team: p.team?.name ?? null, role: p.role_info?.name ?? null }))
    const now = nowInIndia()
    try {
      const ai = await askGemini(buildPrompt({ rowNumber: entry.row_number ?? 0, data: entry.raw, text: entry.raw_text }, people, now), geminiKey)
      const d = decide(ai, people, now.date)
      const parsed = { ...ai, suggested: d.task ?? null }
      await db.from('perisclaw_entries').update({ parsed }).eq('id', entry.id)
      return reply({ parsed, reason: d.reason })
    } catch (e) {
      const msg = e instanceof GeminiBusy ? `${e.message}. Please try again in a minute.` : e instanceof Error ? e.message : String(e)
      return reply({ error: msg }, 502)
    }
  }
  const { data: settings, error: sErr } = await db.from('perisclaw_settings').select('*').eq('id', 1).single()
  if (sErr || !settings) return reply({ error: sErr?.message ?? 'No settings' }, 500)

  const finish = async (patch: Record<string, unknown>) => {
    await db.from('perisclaw_settings').update({ last_checked_at: new Date().toISOString(), ...patch }).eq('id', 1)
    return reply(patch)
  }

  if (!settings.enabled || !settings.sheet_id) return reply({ skipped: 'Perisclaw sync is switched off' })
  if (!settings.assigner_id) return finish({ last_error: 'Choose which admin the tasks are created as' })

  // 1. Read the sheet: as the robot account if its key is set, otherwise via the public link.
  let rows: SheetRow[] = []
  try {
    if (sa) {
      rows = valuesToRows(await readSheetValues(sa, settings.sheet_id, settings.sheet_gid ?? '0'))
    } else {
      const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(settings.sheet_id)}/export?format=csv&gid=${encodeURIComponent(settings.sheet_gid ?? '0')}`
      const res = await fetch(url, { redirect: 'follow' })
      const type = res.headers.get('content-type') ?? ''
      const csv = await res.text()
      if (!res.ok || type.includes('text/html')) {
        return finish({ last_error: `Can't read the sheet (${res.status}). Add the robot account (GOOGLE_SERVICE_ACCOUNT_JSON secret) and share the sheet with it, or share the sheet as "Anyone with the link → Viewer".` })
      }
      rows = sheetRows(csv)
    }
  } catch (e) {
    return finish({ last_error: e instanceof Error ? e.message : String(e) })
  }

  const keyed = await Promise.all(rows.map(async (r) => ({ row: r, hash: await sha256(rowKey(r)) })))

  // 2. First read of a newly connected sheet: remember what's already there (unless importing).
  if (!settings.baseline_done && !settings.import_existing) {
    if (keyed.length) {
      await db.from('perisclaw_entries').upsert(keyed.map(({ row, hash }) => ({
        row_hash: hash, row_number: row.rowNumber, raw: row.data, raw_text: row.text,
        status: 'skipped_existing', processed_at: new Date().toISOString(),
        reason: 'Already in the sheet when it was connected',
      })), { onConflict: 'row_hash', ignoreDuplicates: true })
    }
    return finish({ baseline_done: true, last_error: null, last_result: `Connected. ${keyed.length} row(s) already in the sheet were not added (use "Add as task" below if needed); new rows become tasks.` })
  }

  // 3. New rows only (claim them so a parallel run can't take the same ones).
  const { data: known } = await db.from('perisclaw_entries').select('row_hash').in('row_hash', keyed.map((k) => k.hash))
  const seen = new Set((known ?? []).map((k) => k.row_hash))
  const fresh = keyed.filter((k) => !seen.has(k.hash))
  if (fresh.length && !geminiKey) return finish({ last_error: `${fresh.length} new row(s) waiting: add the GEMINI_API_KEY secret in Supabase → Edge Functions → Secrets.` })

  const batch = fresh.slice(0, MAX_ROWS_PER_RUN)
  const { data: claimed } = batch.length
    ? await db.from('perisclaw_entries').upsert(batch.map(({ row, hash }) => ({
        row_hash: hash, row_number: row.rowNumber, raw: row.data, raw_text: row.text, status: 'processing',
      })), { onConflict: 'row_hash', ignoreDuplicates: true }).select('id, row_hash')
    : { data: [] as { id: string; row_hash: string }[] }
  const idByHash = new Map((claimed ?? []).map((c) => [c.row_hash, c.id]))
  const work: { entryId: string; row: SheetRow; tries: number }[] = batch
    .filter(({ hash }) => idByHash.has(hash))                // another run may have taken some
    .map(({ row, hash }) => ({ entryId: idByHash.get(hash)!, row, tries: 0 }))

  // Rows Gemini was too busy for on an earlier run: try them again (at most MAX_TRIES times each).
  const room = MAX_ROWS_PER_RUN - batch.length
  if (room > 0 && geminiKey) {
    const { data: again } = await db.from('perisclaw_entries')
      .select('id, row_number, raw, raw_text, attempts')
      .eq('status', 'error').lt('attempts', MAX_TRIES).like('reason', `${BUSY_PREFIX}%`)
      .lt('processed_at', new Date(Date.now() - 90_000).toISOString())
      .order('created_at').limit(room)
    const ids = (again ?? []).map((r) => r.id)
    const { data: took } = ids.length
      ? await db.from('perisclaw_entries').update({ status: 'processing' }).in('id', ids).eq('status', 'error').select('id')
      : { data: [] as { id: string }[] }
    const tookIds = new Set((took ?? []).map((t) => t.id))
    for (const r of again ?? []) {
      if (tookIds.has(r.id)) work.push({ entryId: r.id, row: { rowNumber: r.row_number ?? 0, data: r.raw, text: r.raw_text }, tries: r.attempts ?? 0 })
    }
  }
  if (!work.length) return finish({ baseline_done: true, last_error: null, last_result: `No new rows (${keyed.length} in the sheet).` })

  // 4. Who can get tasks.
  const { data: ppl } = await db.from('profiles').select('id, full_name, team:teams(name), role_info:roles(name)').eq('is_active', true).order('full_name')
  const people: Person[] = ((ppl ?? []) as unknown as { id: string; full_name: string; team: { name: string } | null; role_info: { name: string } | null }[])
    .map((p) => ({ id: p.id, full_name: p.full_name, team: p.team?.name ?? null, role: p.role_info?.name ?? null }))
  const now = nowInIndia()

  let created = 0, review = 0, errors = 0, retrying = 0
  for (const { entryId, row, tries } of work) {
    const attempts = tries + 1
    try {
      const ai = await askGemini(buildPrompt(row, people, now), geminiKey)
      const d = decide(ai, people, now.date)
      if (d.ok && d.task) {
        const { data: task, error } = await db.from('tasks').insert({
          ...d.task,
          description: d.task.description || null,
          assigned_by: settings.assigner_id,
          task_type: 'adhoc',
        }).select('id').single()
        if (error) throw new Error(error.message)
        await db.from('perisclaw_entries').update({ status: 'created', parsed: ai, task_id: task.id, reason: null, attempts, processed_at: new Date().toISOString() }).eq('id', entryId)
        created++
      } else {
        await db.from('perisclaw_entries').update({ status: 'needs_review', parsed: { ...ai, suggested: d.task ?? null }, reason: d.reason, attempts, processed_at: new Date().toISOString() }).eq('id', entryId)
        review++
      }
    } catch (e) {
      let reason = e instanceof Error ? e.message : String(e)
      if (e instanceof GeminiBusy) {
        if (attempts < MAX_TRIES) { reason = `${e.message}. Trying again automatically in 2 minutes (try ${attempts} of ${MAX_TRIES}).`; retrying++ }
        else reason = `${e.message}. Tried ${MAX_TRIES} times; use "Add as task" to try again.`
      }
      await db.from('perisclaw_entries').update({ status: 'error', reason, attempts, processed_at: new Date().toISOString() }).eq('id', entryId)
      errors++
    }
  }

  const left = fresh.length - batch.length
  const parts = [`${work.length} row(s) read: ${created} task(s) created`, review ? `${review} need review` : '',
    errors - retrying ? `${errors - retrying} error(s)` : '', retrying ? `${retrying} will retry (Gemini busy)` : '', left ? `${left} more next run` : '']
  return finish({ baseline_done: true, last_error: errors > retrying && !created && !review ? 'Gemini could not read the rows — see the list below' : null, last_result: parts.filter(Boolean).join(', ') + '.' })
})

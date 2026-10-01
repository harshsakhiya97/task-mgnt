// Supabase Edge Function: sends queued phone notifications (Web Push) — used for task reminders.
// Called by the database (private.push_kick) right after a reminder is queued, and every minute as a safety net.
// It takes no input and only works through public.push_outbox, so calling it early does no harm
// (deployed with verify_jwt off for the database call).
//
// Keys: on the first run it creates a VAPID key pair; the private key goes to Supabase Vault, the public key to
// private.app_settings (the app reads it with push_public_key() to subscribe a phone). Nothing to set up by hand.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { generateVapidKeys, sendPush, type Vapid } from './webpush.ts'

interface Msg { id: string; title: string; body: string; url: string | null; tag: string | null; subs: { id: string; endpoint: string; p256dh: string; auth: string }[] }

Deno.serve(async () => {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  let { data: keys } = await db.rpc('push_get_keys')
  if (!keys?.public || !keys?.private) {
    const k = await generateVapidKeys()
    const { error } = await db.rpc('push_set_keys', { p_public: k.publicKey, p_private: k.privateJwk })
    if (error) return Response.json({ error: `Couldn't save keys: ${error.message}` }, { status: 500 })
    keys = (await db.rpc('push_get_keys')).data
  }
  const subject = String(keys.subject ?? '')
  const vapid: Vapid = { publicKey: keys.public, privateJwk: keys.private, subject: subject.startsWith('https://') ? subject : 'https://pride.viralsakhiya.com' }

  const { data, error } = await db.rpc('push_claim_batch', { p_limit: 50 })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  let sent = 0, noDevice = 0, failed = 0
  for (const m of (data ?? []) as Msg[]) {
    if (!m.subs.length) {
      await db.rpc('push_mark', { p_id: m.id, p_status: 'no_device', p_error: 'Notifications not turned on for this person' })
      noDevice++; continue
    }
    const payload = JSON.stringify({ title: m.title, body: m.body, url: m.url, tag: m.tag })
    const ok: string[] = [], gone: string[] = [], bad: Record<string, string> = {}
    let retry = false
    await Promise.all(m.subs.map(async (s) => {
      try {
        const r = await sendPush(s, payload, vapid)
        if (r.ok) ok.push(s.id)
        else if (r.gone) gone.push(s.id)
        else { bad[s.id] = r.error ?? 'failed'; if (r.status === 429 || r.status >= 500) retry = true }
      } catch (e) { bad[s.id] = e instanceof Error ? e.message : String(e); retry = true }
    }))
    const status = ok.length ? 'sent' : retry ? 'retry' : gone.length === m.subs.length ? 'no_device' : 'failed'
    const err = ok.length ? null : Object.values(bad)[0] ?? (gone.length ? 'Phone notifications were turned off on that device' : null)
    await db.rpc('push_mark', { p_id: m.id, p_status: status, p_error: err, p_ok_subs: ok, p_gone_subs: gone, p_failed_subs: bad })
    if (status === 'sent') sent++; else if (status === 'no_device') noDevice++; else failed++
  }
  return Response.json({ sent, no_device: noDevice, failed })
})

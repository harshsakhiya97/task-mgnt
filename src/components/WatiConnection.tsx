import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, KeyRound, PlugZap, Trash2 } from 'lucide-react'
import { Field } from './Fields'
import { supabase } from '../lib/supabase'
import { WA_KIND_LABELS } from '../lib/whatsappTemplates'

const DEFAULT_URL = 'https://live-mt-server.wati.io/10103863'

interface Saved { token_saved: boolean; token_hint: string | null; token_saved_at: string | null; api_url: string | null }
interface Check {
  configured?: boolean; ok?: boolean; error?: string; source?: 'app' | 'supabase-secret' | null; api_url?: string
  templates?: { kind: string; name: string; status: string }[]
}

async function fnError(error: unknown, data: { error?: string } | null) {
  if (data?.error) return data.error
  if (error && typeof error === 'object' && 'context' in error) {
    const body = await (error as { context: Response }).context.json().catch(() => ({}))
    if (body?.error) return body.error as string
  }
  return error instanceof Error ? error.message : 'Something went wrong'
}

const tone = (status: string) => status === 'APPROVED' ? 'active' : status === 'PENDING' || status === 'IN_APPEAL' ? 'manager' : 'inactive'

/**
 * Admin: connect WhatsApp (WATI) from inside the app — no Supabase needed.
 * The token is stored encrypted (Supabase Vault) and never sent back to the browser; only its last 4 characters are shown.
 */
export function WatiConnection() {
  const [saved, setSaved] = useState<Saved | null>(null)
  const [check, setCheck] = useState<Check | null>(null)
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState<'' | 'save' | 'check' | 'remove'>('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const runCheck = useCallback(async () => {
    setBusy('check')
    const { data, error } = await supabase.functions.invoke('whatsapp-sender', { body: { action: 'check' } })
    setBusy('')
    if (error && !data) return setCheck({ ok: false, error: await fnError(error, data) })
    setCheck(data as Check)
  }, [])

  const loadSaved = useCallback(async () => {
    const { data } = await supabase.rpc('whatsapp_config_status')
    if (data) { setSaved(data as Saved); setUrl((data as Saved).api_url ?? '') }
  }, [])

  useEffect(() => { loadSaved(); runCheck() }, [loadSaved, runCheck])

  const save = async (remove = false) => {
    setMsg(null)
    if (!remove && !token.trim() && url.trim() === (saved?.api_url ?? '')) return setMsg({ ok: false, text: 'Paste the access token or change the API URL first.' })
    setBusy(remove ? 'remove' : 'save')
    const { data, error } = await supabase.rpc('whatsapp_set_config', remove
      ? { p_clear_token: true }
      : { p_token: token.trim() || null, p_api_url: url.trim() })
    setBusy('')
    if (error) return setMsg({ ok: false, text: error.message })
    setSaved(data as Saved); setToken('')
    setMsg({ ok: true, text: remove ? 'Token removed.' : 'Saved. Checking the connection…' })
    if (!remove) setOpen(false)
    runCheck()
  }

  const connected = check?.configured && check.ok
  const approved = check?.templates?.filter((t) => t.status === 'APPROVED').length ?? 0

  return (
    <div className="panel wati-panel">
      <div className="wati-head">
        <div className="wati-title">
          <PlugZap size={18} />
          <b>WATI connection</b>
          {busy === 'check' ? <span className="badge">Checking…</span>
            : connected ? <span className="badge active"><CheckCircle2 size={12} /> Connected</span>
            : check ? <span className="badge inactive">{check.configured === false ? 'Not set up' : 'Not working'}</span> : null}
        </div>
        <div className="wati-actions">
          <button className="secondary small-btn" onClick={runCheck} disabled={!!busy}>Check connection</button>
          <button className="small-btn" onClick={() => setOpen((o) => !o)}><KeyRound size={14} /> {saved?.token_saved || check?.source ? 'Change token' : 'Add token'}</button>
        </div>
      </div>

      <div className="wati-summary muted small">
        {saved?.token_saved
          ? <>Token saved in the app · ends with <code>••••{saved.token_hint}</code>{saved.token_saved_at && <> · {new Date(saved.token_saved_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</>}</>
          : check?.source === 'supabase-secret' ? 'Using the token set in Supabase (WATI_TOKEN). You can save one here instead.'
          : 'No access token yet. Click "Add token".'}
        {' · '}API URL: <code>{check?.api_url ?? saved?.api_url ?? DEFAULT_URL}</code>
      </div>

      {check && !check.ok && check.error && <div className="alert error">{check.error}</div>}
      {check?.templates && (
        <div className="wati-templates">
          <span className="muted small">Templates ({approved}/{check.templates.length} approved):</span>
          {check.templates.map((t) => (
            <span key={t.kind} className={`badge ${tone(t.status)}`} title={`${WA_KIND_LABELS[t.kind] ?? t.kind} — WATI template "${t.name}": ${t.status}`}>
              {t.name} · {t.status === 'MISSING' ? 'not created' : t.status.toLowerCase()}
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="wati-form">
          <div className="form-grid">
            <Field label="WATI API URL" hint="WATI → API Docs → API Endpoint. Leave empty to use Pride's.">
              <input placeholder={DEFAULT_URL} value={url} onChange={(e) => setUrl(e.target.value)} />
            </Field>
            <Field label="Access token" hint="WATI → API Docs → Access Token. It's stored encrypted and never shown again.">
              <input type="password" autoComplete="off" placeholder={saved?.token_saved ? 'Paste a new token to replace the saved one' : 'Paste the access token'}
                value={token} onChange={(e) => setToken(e.target.value)} />
            </Field>
          </div>
          <div className="pc-actions">
            <button onClick={() => save(false)} disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
            <button className="secondary" onClick={() => { setOpen(false); setToken(''); setUrl(saved?.api_url ?? '') }} disabled={!!busy}>Cancel</button>
            {saved?.token_saved && (
              <button className="danger-outline" onClick={() => save(true)} disabled={!!busy}><Trash2 size={15} /> Remove saved token</button>
            )}
          </div>
        </div>
      )}
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} onClick={() => setMsg(null)}>{msg.text}</div>}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { APP_VERSION, VERSION_LABEL } from '../lib/version'

type Result = { status: 'idle' | 'running' | 'ok' | 'fail'; detail?: string }

function Check({ title, run }: { title: string; run: () => Promise<string> }) {
  const [r, setR] = useState<Result>({ status: 'idle' })
  const go = async () => {
    setR({ status: 'running' })
    try { setR({ status: 'ok', detail: await run() }) }
    catch (e) { setR({ status: 'fail', detail: e instanceof Error ? e.message : String(e) }) }
  }
  return (
    <div className="card">
      <div className="row">
        <h3>{title}</h3>
        <button onClick={go} disabled={r.status === 'running'}>{r.status === 'running' ? 'Testing…' : 'Run test'}</button>
      </div>
      {(r.status === 'ok' || r.status === 'fail') && (
        <pre className={r.status}>{r.status === 'ok' ? 'PASS  ' : 'FAIL  '}{r.detail}</pre>
      )}
    </div>
  )
}

/** Admin-only system check (the original deploy test). */
export function Health() {
  return (
    <>
      <div className="page-head"><div><h2>System Check</h2><p>Confirms the app can reach the Supabase database and Edge Functions.</p></div></div>
      <Check title="Database" run={async () => {
        const { count, error } = await supabase.from('profiles').select('*', { count: 'exact', head: true })
        if (error) throw new Error(error.message)
        return `${count} user profile(s) readable`
      }} />
      <Check title="WhatsApp sender (WATI)" run={async () => {
        const { data, error } = await supabase.functions.invoke('whatsapp-sender', { body: {} })
        if (error) throw new Error(error.message)
        if (!data?.configured) throw new Error('Not set up yet: add the WATI_TOKEN secret in Supabase → Edge Functions → Secrets')
        return `Connected · sent ${data.sent}, failed ${data.failed} in this run`
      }} />
      <Check title="Edge Function (hello)" run={async () => {
        const { data, error } = await supabase.functions.invoke('hello', { body: { name: 'Task Mgnt' } })
        if (error) throw new Error(error.message)
        return JSON.stringify(data)
      }} />
      <WhatsAppLog />
      <p className="muted small">{VERSION_LABEL} ({APP_VERSION}) · Build time: {new Date(__BUILD_TIME__).toLocaleString()}</p>
    </>
  )
}

interface OutRow {
  id: string; kind: string; phone: string | null; status: string; attempts: number
  last_error: string | null; created_at: string; sent_at: string | null
  recipient: { full_name: string } | null
}
const KIND_LABELS: Record<string, string> = { task_assigned: 'Task assigned', task_comment: 'Comment', daily_task_report: 'Day-end report' }
const STATUS_TONE: Record<string, string> = { sent: 'active', queued: 'st-todo', sending: 'st-in_progress', failed: 'inactive', skipped: 'paused', expired: 'paused' }

/** Last 50 WhatsApp messages: what was sent, what is waiting, what failed and why. */
function WhatsAppLog() {
  const [rows, setRows] = useState<OutRow[]>([])
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('whatsapp_outbox')
      .select('id, kind, phone, status, attempts, last_error, created_at, sent_at, recipient:profiles!whatsapp_outbox_recipient_id_fkey(full_name)')
      .order('created_at', { ascending: false }).limit(50)
    setRows((data as unknown as OutRow[]) ?? [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])
  return (
    <div className="panel wa-log">
      <div className="panel-toolbar">
        <h3 style={{ margin: 0 }}>WhatsApp messages</h3>
        <span className="count-pill">last 50</span>
        <span className="spacer" />
        <button className="secondary" onClick={load}><RefreshCw size={15} /> Refresh</button>
      </div>
      <div className="table-scroll">
        {loading ? <div className="empty">Loading…</div> : rows.length === 0 ? (
          <div className="empty"><b>No WhatsApp messages yet</b>Messages appear here when tasks are assigned, commented on, or at the day-end report.</div>
        ) : (
          <table>
            <thead><tr><th>Time</th><th>Message</th><th>To</th><th>Phone</th><th>Status</th><th>Details</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' })}</td>
                  <td>{KIND_LABELS[r.kind] ?? r.kind}</td>
                  <td>{r.recipient?.full_name ?? '—'}</td>
                  <td>{r.phone ? `+${r.phone}` : '—'}</td>
                  <td><span className={`badge ${STATUS_TONE[r.status] ?? ''}`}>{r.status[0].toUpperCase() + r.status.slice(1)}</span></td>
                  <td className="muted small">{r.last_error ?? (r.sent_at ? `Sent ${new Date(r.sent_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : r.attempts ? `${r.attempts} attempt(s)` : '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

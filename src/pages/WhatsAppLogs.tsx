import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock3, MessageCircle, RefreshCw, RotateCcw, Search, UserX, XCircle } from 'lucide-react'
import { Drawer } from '../components/Drawer'
import { Pagination } from '../components/Pagination'
import { StatCard } from '../components/StatCard'
import { supabase } from '../lib/supabase'
import { addDays, todayStr } from '../lib/tasks'
import { renderWhatsApp, WA_KIND_LABELS } from '../lib/whatsappTemplates'

export interface WaLog {
  id: string
  kind: string
  phone: string | null
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'skipped' | 'expired'
  attempts: number
  last_error: string | null
  params: Record<string, unknown>
  task_id: string | null
  created_at: string
  sent_at: string | null
  send_after: string
  recipient: { full_name: string } | null
}

const STATUS_LABELS: Record<WaLog['status'], string> = {
  queued: 'Waiting', sending: 'Sending', sent: 'Sent', failed: 'Failed', skipped: 'Skipped', expired: 'Expired',
}
const STATUS_TONE: Record<WaLog['status'], string> = {
  sent: 'active', queued: 'st-todo', sending: 'st-in_progress', failed: 'inactive', skipped: 'paused', expired: 'paused',
}
type StatusFilter = '' | WaLog['status']

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

/** Admin: every WhatsApp message the app sent (or tried to), with filters and resend. */
export function WhatsAppLogs() {
  const [from, setFrom] = useState(() => addDays(todayStr(), -6))
  const [to, setTo] = useState(todayStr)
  const [rows, setRows] = useState<WaLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<StatusFilter>('')
  const [kind, setKind] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [open, setOpen] = useState<WaLog | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    // Dates are the viewer's local days (IST).
    const start = new Date(from + 'T00:00:00').toISOString()
    const end = new Date(addDays(to, 1) + 'T00:00:00').toISOString()
    const { data, error } = await supabase.from('whatsapp_outbox')
      .select('id, kind, phone, status, attempts, last_error, params, task_id, created_at, sent_at, send_after, recipient:profiles!whatsapp_outbox_recipient_id_fkey(full_name)')
      .gte('created_at', start).lt('created_at', end)
      .order('created_at', { ascending: false }).limit(2000)
    if (error) setError(error.message)
    setRows((data as unknown as WaLog[]) ?? [])
    setLoading(false)
  }, [from, to])
  useEffect(() => { load() }, [load])

  const counts = useMemo(() => {
    const c = { total: rows.length, sent: 0, waiting: 0, failed: 0, skipped: 0, expired: 0 }
    for (const r of rows) {
      if (r.status === 'sent') c.sent++
      else if (r.status === 'queued' || r.status === 'sending') c.waiting++
      else if (r.status === 'failed') c.failed++
      else if (r.status === 'skipped') c.skipped++
      else if (r.status === 'expired') c.expired++
    }
    return c
  }, [rows])

  const visible = rows.filter((r) => {
    if (status === 'queued' ? !(r.status === 'queued' || r.status === 'sending') : status && r.status !== status) return false
    if (kind && r.kind !== kind) return false
    const q = search.trim().toLowerCase()
    return !q || (r.recipient?.full_name ?? '').toLowerCase().includes(q) || (r.phone ?? '').includes(q.replace(/\D/g, '') || '§')
      || String(r.params.task ?? '').toLowerCase().includes(q)
  })
  useEffect(() => { setPage(1) }, [status, kind, search, from, to, pageSize])
  const pageRows = visible.slice((page - 1) * pageSize, page * pageSize)

  return (
    <>
      <div className="page-head">
        <div>
          <h2>WhatsApp Logs</h2>
          <p>Every WhatsApp message the app sent or tried to send through WATI: who it went to, when, and what happened. Click a row to see the message.</p>
        </div>
        <div className="head-actions">
          <button className="secondary" onClick={load}><RefreshCw size={16} /> Refresh</button>
        </div>
      </div>

      {error && <div className="alert error" onClick={() => setError('')}>{error}</div>}

      <div className="stats tab-stats">
        <StatCard icon={MessageCircle} tone="navy" value={counts.total} label="All Messages" onClick={() => setStatus('')} active={status === ''} />
        <StatCard icon={CheckCircle2} tone="green" value={counts.sent} label="Sent" onClick={() => setStatus('sent')} active={status === 'sent'} />
        <StatCard icon={Clock3} tone="blue" value={counts.waiting} label="Waiting" onClick={() => setStatus('queued')} active={status === 'queued'} />
        <StatCard icon={XCircle} tone="red" value={counts.failed} label="Failed" onClick={() => setStatus('failed')} active={status === 'failed'} />
        <StatCard icon={UserX} tone="yellow" value={counts.skipped} label="Skipped (no number)" onClick={() => setStatus('skipped')} active={status === 'skipped'} />
        <StatCard icon={AlertTriangle} tone="orange" value={counts.expired} label="Expired" onClick={() => setStatus('expired')} active={status === 'expired'} />
      </div>

      <div className="panel">
        <div className="panel-toolbar">
          <span className="tab-chip"><MessageCircle size={18} /> Messages</span>
          <span className="count-pill">{visible.length} Messages</span>
          <span className="spacer" />
          <div className="search-box">
            <Search size={16} />
            <input placeholder="Search person, phone or task" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="filters">
          <select className="pill-select" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All Types</option>
            {Object.entries(WA_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="pill-select" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="">All Statuses</option>
            <option value="sent">Sent</option>
            <option value="queued">Waiting</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped</option>
            <option value="expired">Expired</option>
          </select>
          <label className="date-filter">From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="date-filter">To <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <div className="table-scroll">
          {loading ? <div className="empty">Loading…</div> : visible.length === 0 ? (
            <div className="empty"><MessageCircle size={40} /><b>No messages here</b>{rows.length ? 'Try changing the filters.' : 'Messages appear when tasks are assigned, commented on, and at the 9:15 pm report.'}</div>
          ) : (
            <table>
              <thead>
                <tr><th>Time</th><th>Type</th><th>To</th><th>Phone</th><th>Task</th><th>Status</th><th>Details</th></tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => setOpen(r)}>
                    <td>{when(r.created_at)}</td>
                    <td>{WA_KIND_LABELS[r.kind] ?? r.kind}</td>
                    <td>{r.recipient?.full_name ?? '—'}</td>
                    <td>{r.phone ? `+${r.phone}` : '—'}</td>
                    <td><div className="task-title" title={String(r.params.task ?? '')}>{String(r.params.task ?? (r.kind === 'daily_task_report' ? `Report ${r.params.date ?? ''}` : '—'))}</div></td>
                    <td><span className={`badge ${STATUS_TONE[r.status]}`}>{STATUS_LABELS[r.status]}</span></td>
                    <td className="muted small wa-detail">{detailText(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Pagination page={page} pageSize={pageSize} total={visible.length} onPage={setPage} onPageSize={setPageSize} />
      </div>

      {open && <MessageDrawer log={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); load() }} />}
    </>
  )
}

function detailText(r: WaLog) {
  if (r.last_error) return r.last_error
  if (r.status === 'sent' && r.sent_at) return `Sent at ${new Date(r.sent_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`
  if (r.status === 'queued') return new Date(r.send_after) > new Date() ? `Goes out at ${new Date(r.send_after).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : 'Going out now'
  return r.attempts ? `${r.attempts} attempt(s)` : ''
}

function MessageDrawer({ log, onClose, onChanged }: { log: WaLog; onClose: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const canRetry = log.status === 'failed' || log.status === 'expired' || log.status === 'skipped'

  const retry = async () => {
    setBusy(true); setError('')
    const { error } = await supabase.rpc('whatsapp_retry', { p_id: log.id })
    setBusy(false)
    if (error) setError(error.message); else onChanged()
  }

  return (
    <Drawer title={WA_KIND_LABELS[log.kind] ?? 'WhatsApp message'} onClose={onClose} hideSubmit>
      <dl className="kv">
        <dt>To</dt><dd>{log.recipient?.full_name ?? '—'}{log.phone ? ` · +${log.phone}` : ''}</dd>
        <dt>Status</dt><dd><span className={`badge ${STATUS_TONE[log.status]}`}>{STATUS_LABELS[log.status]}</span></dd>
        <dt>Created</dt><dd>{when(log.created_at)}</dd>
        {log.sent_at && <><dt>Sent</dt><dd>{when(log.sent_at)}</dd></>}
        <dt>Attempts</dt><dd>{log.attempts}</dd>
        {log.last_error && <><dt>Problem</dt><dd className="overdue-text">{log.last_error}</dd></>}
      </dl>
      <div className="form-section">Message</div>
      <div className="wa-bubble">{renderWhatsApp(log.kind, log.params)}</div>
      {canRetry && (
        <div style={{ marginTop: 16 }}>
          <button type="button" onClick={retry} disabled={busy}><RotateCcw size={16} /> {busy ? 'Queuing…' : 'Send again'}</button>
          <p className="muted small">Uses the person's current WhatsApp number from their profile.</p>
        </div>
      )}
      {error && <div className="alert error">{error}</div>}
    </Drawer>
  )
}

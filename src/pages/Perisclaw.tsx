import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bot, CheckCircle2, CircleSlash, ExternalLink, FileSpreadsheet, RefreshCw, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Drawer } from '../components/Drawer'
import { Field } from '../components/Fields'
import { Pagination } from '../components/Pagination'
import { StatCard } from '../components/StatCard'
import { TimeRangeInput, timePairError, toDbTime } from '../components/TimeRangeInput'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { PRIORITY_LABELS, taskCode, todayStr, type TaskPriority } from '../lib/tasks'
import { useActiveUsers } from '../lib/useActiveUsers'

interface Settings {
  sheet_url: string | null; sheet_id: string | null; enabled: boolean; assigner_id: string | null
  import_existing: boolean; baseline_done: boolean
  last_checked_at: string | null; last_error: string | null; last_result: string | null
}
interface Parsed {
  is_task?: boolean; assignee_text?: string; title?: string; description?: string; due_date?: string
  start_time?: string; end_time?: string; priority?: TaskPriority; confidence?: number; note?: string
  suggested?: { assigned_to: string; title: string; description: string; due_date: string; start_time: string | null; end_time: string | null; priority: TaskPriority } | null
}
interface Entry {
  id: string; row_number: number | null; raw_text: string; status: string; parsed: Parsed | null
  reason: string | null; task_id: string | null; created_at: string; processed_at: string | null
  task: { task_no: number; title: string; assignee: { full_name: string } | null } | null
}

const STATUS_LABELS: Record<string, string> = {
  processing: 'Reading…', created: 'Task created', needs_review: 'Needs review', ignored: 'Ignored',
  skipped_existing: 'Old row (skipped)', error: 'Error',
}
const STATUS_TONE: Record<string, string> = {
  created: 'active', needs_review: 'manager', ignored: 'paused', skipped_existing: 'paused', error: 'inactive', processing: 'st-in_progress',
}
type Filter = '' | 'created' | 'needs_review' | 'error' | 'other'

const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—'

/** Admin: connect the Google Sheet Perisclaw writes to, and see what became of each row. */
export function Perisclaw() {
  const { profile } = useAuth()
  const users = useActiveUsers()
  const [s, setS] = useState<Settings | null>(null)
  const [url, setUrl] = useState('')
  const [assigner, setAssigner] = useState('')
  const [importExisting, setImportExisting] = useState(false)
  const [gemini, setGemini] = useState<boolean | null>(null)
  const [robot, setRobot] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [entries, setEntries] = useState<Entry[]>([])
  const [filter, setFilter] = useState<Filter>('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [reviewing, setReviewing] = useState<Entry | null>(null)
  const [admins, setAdmins] = useState<{ id: string; full_name: string }[]>([])

  const load = useCallback(async () => {
    const [st, en, ad] = await Promise.all([
      supabase.from('perisclaw_settings').select('*').eq('id', 1).single(),
      supabase.from('perisclaw_entries')
        .select('id, row_number, raw_text, status, parsed, reason, task_id, created_at, processed_at, task:tasks(task_no, title, assignee:profiles!tasks_assigned_to_fkey(full_name))')
        .order('created_at', { ascending: false }).limit(1000),
      supabase.from('profiles').select('id, full_name, role_info:roles!inner(is_admin)').eq('is_active', true).eq('role_info.is_admin', true).order('full_name'),
    ])
    if (st.data) {
      const d = st.data as Settings
      setS(d); setUrl(d.sheet_url ?? ''); setAssigner(d.assigner_id ?? ''); setImportExisting(d.import_existing)
    }
    setEntries((en.data as unknown as Entry[]) ?? [])
    setAdmins((ad.data as unknown as { id: string; full_name: string }[]) ?? [])
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    supabase.functions.invoke('perisclaw-sync', { body: { action: 'status' } }).then(({ data }) => { setGemini(!!data?.gemini); setRobot(data?.robot ?? null) })
  }, [])
  useEffect(() => { if (!assigner && profile && admins.some((a) => a.id === profile.id)) setAssigner(profile.id) }, [assigner, profile, admins])

  const save = async (enabled: boolean) => {
    setBusy('save'); setMsg(null)
    const { error } = await supabase.from('perisclaw_settings')
      .update({ sheet_url: url.trim() || null, assigner_id: assigner || null, import_existing: importExisting, enabled }).eq('id', 1)
    setBusy('')
    if (error) return setMsg({ ok: false, text: error.message })
    setMsg({ ok: true, text: enabled ? 'Saved and switched on. Checking the sheet now…' : 'Saved. Sync is switched off.' })
    await load()
    if (enabled) syncNow()
  }

  const syncNow = async () => {
    setBusy('sync')
    const { error } = await supabase.functions.invoke('perisclaw-sync', { body: {} })
    setBusy('')
    if (error) setMsg({ ok: false, text: error.message })
    await load()
  }

  const counts = useMemo(() => ({
    all: entries.filter((e) => e.status !== 'skipped_existing').length,
    created: entries.filter((e) => e.status === 'created').length,
    review: entries.filter((e) => e.status === 'needs_review').length,
    error: entries.filter((e) => e.status === 'error').length,
  }), [entries])

  const visible = entries.filter((e) =>
    filter === '' ? true : filter === 'other' ? ['ignored', 'skipped_existing', 'processing'].includes(e.status) : e.status === filter)
  useEffect(() => { setPage(1) }, [filter, pageSize])
  const pageRows = visible.slice((page - 1) * pageSize, page * pageSize)
  const changed = !!s && ((s.sheet_url ?? '') !== url.trim() || (s.assigner_id ?? '') !== assigner || s.import_existing !== importExisting)

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Perisclaw</h2>
          <p>Tasks you give Perisclaw on WhatsApp land in a Google Sheet. The app reads new rows every 2 minutes, lets Gemini (AI) pick out who, what and when, and creates the tasks. Rows it isn't sure about wait here for you.</p>
        </div>
        <div className="head-actions">
          <button className="secondary" onClick={syncNow} disabled={!s?.enabled || busy !== ''}><RefreshCw size={16} /> {busy === 'sync' ? 'Checking…' : 'Sync now'}</button>
        </div>
      </div>

      <div className="panel pc-settings">
        <div className="pc-grid">
          <div>
            <Field label="Google Sheet link" required hint={robot ? `Share the sheet with the robot account below as Viewer. The app reads the tab that is open in the link.` : 'Add the robot account (see right), then share the sheet with it as Viewer. The app reads the tab that is open in the link.'}>
              <input placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=0" value={url} onChange={(e) => setUrl(e.target.value)} />
            </Field>
            <div className="form-grid">
              <Field label="Create tasks as" required hint="Tasks show this admin as the assigner.">
                <select value={assigner} onChange={(e) => setAssigner(e.target.value)}>
                  <option value="" disabled>Select admin</option>
                  {admins.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                </select>
              </Field>
              <Field label="Rows already in the sheet" hint="Applies when a new sheet link is saved.">
                <select value={importExisting ? 'import' : 'skip'} onChange={(e) => setImportExisting(e.target.value === 'import')}>
                  <option value="skip">Skip them — only new rows</option>
                  <option value="import">Import them as tasks too</option>
                </select>
              </Field>
            </div>
            <div className="pc-actions">
              {s?.enabled
                ? <>
                    {changed && <button onClick={() => save(true)} disabled={busy !== ''}>Save changes</button>}
                    <button className="danger-outline" onClick={() => save(false)} disabled={busy !== ''}><CircleSlash size={16} /> Switch off</button>
                  </>
                : <button onClick={() => save(true)} disabled={busy !== '' || !url.trim() || !assigner}><CheckCircle2 size={16} /> Save & switch on</button>}
              {s?.sheet_url && <a className="link" href={s.sheet_url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open sheet</a>}
            </div>
            {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
          </div>
          <div className="pc-status">
            <div className="pc-status-row"><span>Sync</span><b className={s?.enabled ? 'ok-text' : 'muted'}>{s?.enabled ? 'On — every 2 minutes' : 'Off'}</b></div>
            <div className="pc-status-row"><span>Gemini AI</span>
              <b className={gemini ? 'ok-text' : 'overdue-text'}>{gemini === null ? '…' : gemini ? 'Key added' : 'Key missing'}</b></div>
            <div className="pc-status-row"><span>Robot account</span>
              <b className={robot ? 'ok-text' : 'overdue-text'}>{robot ? 'Added' : 'Not added'}</b></div>
            {robot && (
              <div className="pc-robot">
                <small className="muted">Share the sheet with this email as <b>Viewer</b>:</small>
                <div className="pc-robot-email">
                  <code>{robot}</code>
                  <button type="button" className="secondary small-btn" onClick={() => { navigator.clipboard?.writeText(robot); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>{copied ? 'Copied' : 'Copy'}</button>
                </div>
              </div>
            )}
            <div className="pc-status-row"><span>Last checked</span><b>{when(s?.last_checked_at ?? null)}</b></div>
            {s?.last_result && <div className="pc-status-note">{s.last_result}</div>}
            {s?.last_error && <div className="alert error">{s.last_error}</div>}
            {robot === null && gemini !== null && <p className="muted small">Add the robot account's JSON key as the <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> secret in Supabase → Edge Functions → Secrets (see docs/perisclaw.md).</p>}
            {gemini === false && <p className="muted small">Add the free key from aistudio.google.com as the <code>GEMINI_API_KEY</code> secret in Supabase → Edge Functions → Secrets.</p>}
          </div>
        </div>
      </div>

      <div className="stats tab-stats">
        <StatCard icon={FileSpreadsheet} tone="navy" value={counts.all} label="Rows Read" onClick={() => setFilter('')} active={filter === ''} />
        <StatCard icon={CheckCircle2} tone="green" value={counts.created} label="Tasks Created" onClick={() => setFilter('created')} active={filter === 'created'} />
        <StatCard icon={Sparkles} tone="yellow" value={counts.review} label="Needs Review" onClick={() => setFilter('needs_review')} active={filter === 'needs_review'} />
        <StatCard icon={AlertTriangle} tone="red" value={counts.error} label="Errors" onClick={() => setFilter('error')} active={filter === 'error'} />
      </div>

      <div className="panel">
        <div className="panel-toolbar">
          <span className="tab-chip"><Bot size={18} /> Sheet rows</span>
          <span className="count-pill">{visible.length} Rows</span>
          <span className="spacer" />
          <select className="pill-select" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="">All rows</option>
            <option value="created">Task created</option>
            <option value="needs_review">Needs review</option>
            <option value="error">Errors</option>
            <option value="other">Ignored / old rows</option>
          </select>
        </div>
        <div className="table-scroll">
          {visible.length === 0 ? (
            <div className="empty"><FileSpreadsheet size={40} /><b>No rows yet</b>{s?.enabled ? 'New rows in the sheet show up here within 2 minutes.' : 'Paste the sheet link above and switch it on.'}</div>
          ) : (
            <table>
              <thead><tr><th>Read at</th><th>Row</th><th>Sheet text</th><th>AI understood</th><th>Status</th><th>Task</th></tr></thead>
              <tbody>
                {pageRows.map((e) => (
                  <tr key={e.id} className={e.status === 'needs_review' || e.status === 'error' ? 'clickable' : ''}
                    onClick={() => (e.status === 'needs_review' || e.status === 'error') && setReviewing(e)}>
                    <td>{when(e.created_at)}</td>
                    <td>{e.row_number ?? '—'}</td>
                    <td><div className="pc-raw" title={e.raw_text}>{e.raw_text}</div></td>
                    <td className="small">{e.parsed ? <AiSummary p={e.parsed} users={users} /> : <span className="muted">—</span>}</td>
                    <td>
                      <span className={`badge ${STATUS_TONE[e.status] ?? ''}`}>{STATUS_LABELS[e.status] ?? e.status}</span>
                      {e.reason && e.status !== 'skipped_existing' && <div className="muted small pc-reason">{e.reason}</div>}
                    </td>
                    <td>
                      {e.task ? <Link to={`/tasks?task=${e.task_id}`} onClick={(ev) => ev.stopPropagation()} className="task-no">{taskCode(e.task.task_no)}</Link>
                        : (e.status === 'needs_review' || e.status === 'error') ? <button className="secondary small-btn">Review</button> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Pagination page={page} pageSize={pageSize} total={visible.length} onPage={setPage} onPageSize={setPageSize} />
      </div>

      {reviewing && <ReviewDrawer entry={reviewing} users={users} assignerId={profile?.id ?? ''}
        onClose={() => setReviewing(null)} onDone={() => { setReviewing(null); load() }} />}
    </>
  )
}

function AiSummary({ p, users }: { p: Parsed; users: { id: string; full_name: string }[] }) {
  const who = p.suggested ? users.find((u) => u.id === p.suggested!.assigned_to)?.full_name : null
  const time = p.suggested?.start_time ? ` ${p.suggested.start_time.slice(0, 5)}–${(p.suggested.end_time ?? '').slice(0, 5)}` : ''
  return (
    <div className="pc-ai">
      <div><b>{who ?? p.assignee_text ?? '?'}</b> · {p.title || '—'}</div>
      <div className="muted">{p.due_date || 'no date'}{time}{p.priority ? ` · ${PRIORITY_LABELS[p.priority]}` : ''}{typeof p.confidence === 'number' ? ` · ${Math.round(p.confidence * 100)}% sure` : ''}</div>
    </div>
  )
}

/** Finish a row the AI wasn't sure about: fix the fields and create the task, or ignore the row. */
function ReviewDrawer({ entry, users, assignerId, onClose, onDone }: {
  entry: Entry; users: { id: string; full_name: string }[]; assignerId: string; onClose: () => void; onDone: () => void
}) {
  const p = entry.parsed ?? {}
  const sug = p.suggested
  const [assignedTo, setAssignedTo] = useState(sug?.assigned_to ?? '')
  const [title, setTitle] = useState(sug?.title ?? p.title ?? '')
  const [description, setDescription] = useState(sug?.description ?? p.description ?? '')
  const [dueDate, setDueDate] = useState(sug?.due_date && sug.due_date >= todayStr() ? sug.due_date : todayStr())
  const [from, setFrom] = useState(sug?.start_time?.slice(0, 5) ?? '')
  const [to, setTo] = useState(sug?.end_time?.slice(0, 5) ?? '')
  const [priority, setPriority] = useState<TaskPriority>(sug?.priority ?? p.priority ?? 'medium')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    setError('')
    const te = timePairError(from, to)
    if (te) return setError(te)
    if (!assignedTo || !title.trim() || !dueDate) return setError('Choose the person, and fill in the task and due date')
    setBusy(true)
    const { data: task, error } = await supabase.from('tasks').insert({
      title: title.trim(),
      description: [description.trim(), `From Perisclaw (sheet row ${entry.row_number ?? '?'}):\n${entry.raw_text}`].filter(Boolean).join('\n\n'),
      assigned_by: assignerId, assigned_to: assignedTo, due_date: dueDate,
      start_time: toDbTime(from), end_time: toDbTime(to), priority, task_type: 'adhoc',
    }).select('id').single()
    if (error) { setBusy(false); return setError(error.message) }
    const { error: e2 } = await supabase.from('perisclaw_entries').update({ status: 'created', task_id: task.id }).eq('id', entry.id)
    setBusy(false)
    if (e2) return setError(e2.message)
    onDone()
  }

  const ignore = async () => {
    setBusy(true)
    const { error } = await supabase.from('perisclaw_entries').update({ status: 'ignored', reason: 'Ignored by admin' }).eq('id', entry.id)
    setBusy(false)
    if (error) setError(error.message); else onDone()
  }

  return (
    <Drawer title="Review sheet row" onClose={onClose} onSubmit={create} submitLabel="Create Task" busy={busy}>
      <div className="form-section">From the sheet (row {entry.row_number ?? '?'})</div>
      <div className="wa-bubble pc-source">{entry.raw_text}</div>
      {entry.reason && <div className="alert info">Why it needs review: {entry.reason}</div>}
      <div className="form-section">Task</div>
      <div className="form-grid">
        <Field label="Assign To" required hint={p.assignee_text ? `Sheet says: "${p.assignee_text}"` : undefined}>
          <select required value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            <option value="" disabled>Select person</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Title" required><input required value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Description"><textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div className="form-grid">
        <Field label="Due Date" required><input type="date" required min={todayStr()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
      </div>
      <TimeRangeInput from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }} label="Time (optional)" />
      {error && <div className="alert error">{error}</div>}
      <button type="button" className="danger-outline" onClick={ignore} disabled={busy} style={{ marginTop: 12 }}>Ignore this row</button>
    </Drawer>
  )
}

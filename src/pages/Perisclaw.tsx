import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bot, SlidersHorizontal, UserX, CheckCircle2, CircleSlash, ExternalLink, FileSpreadsheet, Plus, RefreshCw, Sparkles, X } from 'lucide-react'
import { Drawer } from '../components/Drawer'
import { Field } from '../components/Fields'
import { Pagination } from '../components/Pagination'
import { StatCard } from '../components/StatCard'
import { SubTabs, useSubView } from '../components/SubTabs'
import { TaskForm } from '../components/TaskForm'
import { TaskView } from '../components/TaskView'
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
  suggested?: { assigned_to: string | null; title: string; description: string; due_date: string; start_time: string | null; end_time: string | null; priority: TaskPriority } | null
}
interface Entry {
  id: string; row_number: number | null; raw_text: string; status: string; parsed: Parsed | null
  reason: string | null; task_id: string | null; created_at: string; processed_at: string | null
  task: { task_no: number; title: string; assigned_to: string | null; assignee: { full_name: string } | null } | null
}

const STATUS_LABELS: Record<string, string> = {
  processing: 'Reading…', created: 'Added as task', needs_review: 'Needs review', ignored: 'Skipped',
  skipped_existing: 'Not added (old row)', error: 'Error',
}
const STATUS_TONE: Record<string, string> = {
  created: 'active', needs_review: 'manager', ignored: 'paused', skipped_existing: 'paused', error: 'inactive', processing: 'st-in_progress',
}
type Filter = '' | 'created' | 'unassigned' | 'pending' | 'ignored' | 'error'
/** Added as a task, but nobody has it yet (the person isn't a user). */
const isUnassigned = (e: Entry) => e.status === 'created' && !!e.task && !e.task.assigned_to
const canAct = (st: string) => ['needs_review', 'error', 'ignored', 'skipped_existing'].includes(st)

const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—'

/** Admin: connect the Google Sheet Perisclaw writes to, and see what became of each row. */
export function Perisclaw() {
  const { profile } = useAuth()
  const users = useActiveUsers()
  const [s, setS] = useState<Settings | null>(null)
  const [url, setUrl] = useState('')
  const [assigner, setAssigner] = useState('')
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
  const [viewingTask, setViewingTask] = useState<string | null>(null)
  const [editingTask, setEditingTask] = useState<import('../lib/tasks').Task | null>(null)
  const [rowBusy, setRowBusy] = useState('')
  const [admins, setAdmins] = useState<{ id: string; full_name: string }[]>([])
  // Not connected yet → open on Configuration.
  const [view, setView] = useSubView(['list', 'config'] as const, s && !s.sheet_url ? 'config' : 'list')

  const load = useCallback(async (background = false) => {
    const [st, en, ad] = await Promise.all([
      supabase.from('perisclaw_settings').select('*').eq('id', 1).single(),
      supabase.from('perisclaw_entries')
        .select('id, row_number, raw_text, status, parsed, reason, task_id, created_at, processed_at, task:tasks(task_no, title, assigned_to, assignee:profiles!tasks_assigned_to_fkey(full_name))')
        .order('created_at', { ascending: false }).limit(1000),
      supabase.from('profiles').select('id, full_name, role_info:roles!inner(is_admin)').eq('is_active', true).eq('role_info.is_admin', true).order('full_name'),
    ])
    if (st.data) {
      const d = st.data as Settings
      setS(d)
      if (!background) { setUrl(d.sheet_url ?? ''); setAssigner(d.assigner_id ?? '') }   // don't overwrite what the admin is typing
    }
    if (en.data || !background) setEntries((en.data as unknown as Entry[]) ?? [])
    if (ad.data || !background) setAdmins((ad.data as unknown as { id: string; full_name: string }[]) ?? [])
  }, [])
  useEffect(() => { load() }, [load])
  // Sync runs on the server every 2 minutes: keep "Last checked" and the rows list fresh.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') load(true) }
    const t = window.setInterval(tick, 30_000)
    document.addEventListener('visibilitychange', tick)
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', tick) }
  }, [load])
  useEffect(() => {
    supabase.functions.invoke('perisclaw-sync', { body: { action: 'status' } }).then(({ data }) => { setGemini(!!data?.gemini); setRobot(data?.robot ?? null) })
  }, [])
  useEffect(() => { if (!assigner && profile && admins.some((a) => a.id === profile.id)) setAssigner(profile.id) }, [assigner, profile, admins])

  const save = async (enabled: boolean) => {
    setBusy('save'); setMsg(null)
    const { error } = await supabase.from('perisclaw_settings')
      .update({ sheet_url: url.trim() || null, assigner_id: assigner || null, enabled }).eq('id', 1)
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

  // Row actions
  const skipRow = async (e: Entry) => {
    setRowBusy(e.id)
    const { error } = await supabase.from('perisclaw_entries').update({ status: 'ignored', reason: 'Skipped by admin' }).eq('id', e.id)
    setRowBusy('')
    if (error) setMsg({ ok: false, text: error.message }); else load()
  }
  const addRow = async (e: Entry) => {
    // Rows Gemini hasn't read yet (old rows) are read first, so the form opens pre-filled.
    if (!e.parsed && gemini) {
      setRowBusy(e.id)
      const { data } = await supabase.functions.invoke('perisclaw-sync', { body: { action: 'parse', entry_id: e.id } })
      setRowBusy('')
      if (data?.parsed) return setReviewing({ ...e, parsed: data.parsed, reason: data.reason || e.reason })
    }
    setReviewing(e)
  }

  const counts = useMemo(() => ({
    all: entries.length,
    created: entries.filter((e) => e.status === 'created').length,
    unassigned: entries.filter(isUnassigned).length,
    pending: entries.filter((e) => ['needs_review', 'skipped_existing'].includes(e.status)).length,
    ignored: entries.filter((e) => e.status === 'ignored').length,
    error: entries.filter((e) => e.status === 'error').length,
  }), [entries])

  const visible = entries.filter((e) =>
    filter === '' ? true : filter === 'unassigned' ? isUnassigned(e) : filter === 'pending' ? ['needs_review', 'skipped_existing'].includes(e.status) : e.status === filter)
  useEffect(() => { setPage(1) }, [filter, pageSize])
  const pageRows = visible.slice((page - 1) * pageSize, page * pageSize)
  const changed = !!s && ((s.sheet_url ?? '') !== url.trim() || (s.assigner_id ?? '') !== assigner)

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Perisclaw</h2>
          <p>Tasks you give Perisclaw on WhatsApp land in a Google Sheet. The app reads new rows every 2 minutes, lets Gemini (AI) pick out who, what and when, and adds every row as a task. If the person isn't a user yet, the task is added unassigned and admins get a WhatsApp message to create the user and assign it.</p>
        </div>
        <div className="head-actions">
          <button className="secondary" onClick={syncNow} disabled={!s?.enabled || busy !== ''}><RefreshCw size={16} /> {busy === 'sync' ? 'Checking…' : 'Sync now'}</button>
        </div>
      </div>

      <SubTabs value={view} onChange={setView} options={[
        { value: 'list', label: 'Sheet Rows', icon: FileSpreadsheet, badge: counts.all },
        { value: 'config', label: 'Configuration', icon: SlidersHorizontal },
      ]} />

      {view === 'config' && (
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
      )}

      {view === 'list' && <>
      {!s?.enabled && s && (
        <div className="alert info sub-tabs-alert">
          <span>{s.sheet_url ? 'Perisclaw sync is switched off, so no new rows are read.' : 'No Google Sheet connected yet.'}</span>
          <button className="small-btn" onClick={() => setView('config')}>Open Configuration</button>
        </div>
      )}
      <div className="stats tab-stats">
        <StatCard icon={FileSpreadsheet} tone="navy" value={counts.all} label="All Rows" onClick={() => setFilter('')} active={filter === ''} />
        <StatCard icon={CheckCircle2} tone="green" value={counts.created} label="Added as Task" onClick={() => setFilter('created')} active={filter === 'created'} />
        <StatCard icon={UserX} tone="orange" value={counts.unassigned} label="Unassigned" onClick={() => setFilter('unassigned')} active={filter === 'unassigned'} />
        <StatCard icon={Sparkles} tone="yellow" value={counts.pending} label="Waiting for You" onClick={() => setFilter('pending')} active={filter === 'pending'} />
        <StatCard icon={CircleSlash} tone="purple" value={counts.ignored} label="Skipped" onClick={() => setFilter('ignored')} active={filter === 'ignored'} />
        <StatCard icon={AlertTriangle} tone="red" value={counts.error} label="Errors" onClick={() => setFilter('error')} active={filter === 'error'} />
      </div>

      <div className="panel">
        <div className="panel-toolbar">
          <span className="tab-chip"><Bot size={18} /> Sheet rows</span>
          <span className="count-pill">{visible.length} Rows</span>
          <span className="spacer" />
          <select className="pill-select" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="">All rows</option>
            <option value="created">Added as task</option>
            <option value="unassigned">Unassigned (user not found)</option>
            <option value="pending">Waiting for you</option>
            <option value="ignored">Skipped</option>
            <option value="error">Errors</option>
          </select>
        </div>
        <div className="table-scroll">
          {visible.length === 0 ? (
            <div className="empty"><FileSpreadsheet size={40} /><b>No rows yet</b>{s?.enabled ? 'New rows in the sheet show up here within 2 minutes.' : 'Paste the sheet link above and switch it on.'}</div>
          ) : (
            <table>
              <thead><tr><th>Read at</th><th>Row</th><th>Sheet text</th><th>AI understood</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {pageRows.map((e) => (
                  <tr key={e.id}>
                    <td>{when(e.created_at)}</td>
                    <td>{e.row_number ?? '—'}</td>
                    <td><div className="pc-raw" title={e.raw_text}>{e.raw_text}</div></td>
                    <td className="small">{e.parsed ? <AiSummary p={e.parsed} users={users} /> : <span className="muted">—</span>}</td>
                    <td>
                      <span className={`badge ${STATUS_TONE[e.status] ?? ''}`}>{STATUS_LABELS[e.status] ?? e.status}</span>
                      {e.reason && e.status !== 'skipped_existing' && <div className="muted small pc-reason">{e.status === 'created' ? `Note: ${e.reason}` : e.reason}</div>}
                    </td>
                    <td className="pc-action">
                      {e.status === 'created' && e.task_id ? (<>
                        <button className="link task-no" onClick={() => setViewingTask(e.task_id)} title="Open task">
                          {e.task ? taskCode(e.task.task_no) : 'Open task'}
                        </button>
                        {isUnassigned(e) && <div><span className="badge unassigned" title="The person isn't a user yet. Create the user, then open the task and click Assign.">Unassigned</span></div>}
                      </>) : canAct(e.status) ? (
                        <div className="pc-action-btns">
                          <button className="small-btn" disabled={rowBusy === e.id} onClick={() => addRow(e)}>
                            <Plus size={14} /> {rowBusy === e.id ? 'Reading…' : 'Add as task'}
                          </button>
                          {e.status !== 'ignored' && (
                            <button className="secondary small-btn" disabled={rowBusy === e.id} onClick={() => skipRow(e)}><X size={14} /> Skip</button>
                          )}
                        </div>
                      ) : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Pagination page={page} pageSize={pageSize} total={visible.length} onPage={setPage} onPageSize={setPageSize} />
      </div>
      </>}

      {viewingTask && !editingTask && (
        <TaskView taskId={viewingTask} onClose={() => setViewingTask(null)} onEdit={setEditingTask} onChanged={() => load(true)} />
      )}
      {editingTask && <TaskForm task={editingTask} users={users} onClose={() => setEditingTask(null)} onSaved={() => { setEditingTask(null); load() }} />}
      {reviewing && <ReviewDrawer entry={reviewing} users={users} assignerId={profile?.id ?? ''} gemini={gemini}
        onClose={() => { setReviewing(null); load(true) }} onDone={() => { setReviewing(null); load() }} />}
    </>
  )
}

function AiSummary({ p, users }: { p: Parsed; users: { id: string; full_name: string }[] }) {
  const who = p.suggested?.assigned_to ? users.find((u) => u.id === p.suggested!.assigned_to)?.full_name
    : p.suggested ? `${p.assignee_text || 'No one'} (not a user)` : null
  const time = p.suggested?.start_time ? ` ${p.suggested.start_time.slice(0, 5)}–${(p.suggested.end_time ?? '').slice(0, 5)}` : ''
  return (
    <div className="pc-ai">
      <div><b>{who ?? p.assignee_text ?? '?'}</b> · {p.title || '—'}</div>
      <div className="muted">{p.due_date || 'no date'}{time}{p.priority ? ` · ${PRIORITY_LABELS[p.priority]}` : ''}{typeof p.confidence === 'number' ? ` · ${Math.round(p.confidence * 100)}% sure` : ''}</div>
    </div>
  )
}

/** Numbered points ("1. … 2. …") on their own lines, for AI text that ran them together. */
const tidy = (text: string) => {
  const t = text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))   // "\u20b9" -> ₹
    .replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim()
  if (t.includes('\n') || (t.match(/(^|\s)\d{1,2}[.)]\s/g) ?? []).length < 2) return t
  return t.replace(/\s+(?=\d{1,2}[.)]\s)/g, '\n')
}

function ReviewDrawer({ entry, users, assignerId, gemini, onClose, onDone }: {
  entry: Entry; users: { id: string; full_name: string }[]; assignerId: string; gemini: boolean | null
  onClose: () => void; onDone: () => void
}) {
  const [parsed, setParsed] = useState<Parsed | null>(entry.parsed)
  const [reason, setReason] = useState(entry.reason)
  const [assignedTo, setAssignedTo] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState(todayStr())
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState<'' | 'parse' | 'clear'>('')
  const [error, setError] = useState('')

  /** Put what the AI understood into the form (or empty it). */
  const fill = useCallback((p: Parsed | null) => {
    const sug = p?.suggested
    setAssignedTo(sug?.assigned_to ?? '')
    setTitle(sug?.title ?? p?.title ?? '')
    setDescription(tidy(sug?.description ?? p?.description ?? ''))
    setDueDate(sug?.due_date && sug.due_date >= todayStr() ? sug.due_date : todayStr())
    setFrom(sug?.start_time?.slice(0, 5) ?? '')
    setTo(sug?.end_time?.slice(0, 5) ?? '')
    setPriority(sug?.priority ?? p?.priority ?? 'medium')
  }, [])
  useEffect(() => { fill(entry.parsed) }, [entry.parsed, fill])

  const runAi = async (action: 'parse' | 'clear') => {
    setError(''); setAiBusy(action)
    const { data, error } = await supabase.functions.invoke('perisclaw-sync', { body: { action, entry_id: entry.id } })
    setAiBusy('')
    if (error || data?.error) {
      let text = data?.error as string | undefined
      if (!text && error && 'context' in error) text = (await (error as { context: Response }).context.json().catch(() => ({})))?.error
      return setError(text || error?.message || 'Something went wrong')
    }
    const p = (data?.parsed ?? null) as Parsed | null
    setParsed(p); fill(p)
    if (action === 'parse') setReason(data?.reason || null)
  }
  const p = parsed ?? {}

  const create = async () => {
    setError('')
    const te = timePairError(from, to)
    if (te) return setError(te)
    if (!assignedTo || !title.trim() || !dueDate) return setError('Choose the person, and fill in the task and due date')
    setBusy(true)
    const { data: task, error } = await supabase.from('tasks').insert({
      title: title.trim(),
      description: description.trim() || null,
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
    const { error } = await supabase.from('perisclaw_entries').update({ status: 'ignored', reason: 'Skipped by admin' }).eq('id', entry.id)
    setBusy(false)
    if (error) setError(error.message); else onDone()
  }

  return (
    <Drawer title="Add row as task" onClose={onClose} onSubmit={create} submitLabel="Add as Task" busy={busy}>
      <div className="form-section">From the sheet (row {entry.row_number ?? '?'})</div>
      <div className="wa-bubble pc-source">{entry.raw_text}</div>
      <div className="pc-ai-bar">
        <span className="pc-ai-bar-text">
          <Sparkles size={15} />
          {aiBusy === 'parse' ? 'AI is reading the row…'
            : parsed ? <>Filled by AI{typeof parsed.confidence === 'number' ? ` · ${Math.round(parsed.confidence * 100)}% sure` : ''}</>
            : 'Not filled by AI'}
        </span>
        <span className="pc-ai-bar-btns">
          {gemini && <button type="button" className="small-btn secondary" disabled={!!aiBusy || busy} onClick={() => runAi('parse')}>
            <RefreshCw size={13} className={aiBusy === 'parse' ? 'spin' : undefined} /> {parsed ? 'Regenerate' : 'Fill with AI'}
          </button>}
          {parsed && <button type="button" className="small-btn secondary" disabled={!!aiBusy || busy} onClick={() => runAi('clear')}>
            <X size={13} /> Clear AI
          </button>}
        </span>
      </div>
      {parsed && reason && entry.status !== 'skipped_existing' && <div className="alert info">Why it needs review: {reason}</div>}
      {parsed?.note && <div className="pc-ai-note">AI note: {parsed.note}</div>}
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
      <Field label="Description"><textarea rows={8} className="pc-desc" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div className="form-grid">
        <Field label="Due Date" required><input type="date" required min={todayStr()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
      </div>
      <TimeRangeInput from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }} label="Time (optional)" />
      {error && <div className="alert error">{error}</div>}
      {entry.status !== 'ignored' && <button type="button" className="danger-outline" onClick={ignore} disabled={busy} style={{ marginTop: 12 }}>Skip this row</button>}
    </Drawer>
  )
}

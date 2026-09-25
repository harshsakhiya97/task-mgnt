import { useCallback, useEffect, useState } from 'react'
import { Check, Download, FileText, Forward, Pencil, Send, Trash2, X } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { initials } from '../lib/initials'
import { supabase } from '../lib/supabase'
import {
  canReassign, canSetTime, type RecurringTask, formatDate, formatTime, formatSize, isOverdue, TYPE_LABELS, PRIORITY_LABELS, STATUS_LABELS, TASK_SELECT, taskCode, timeAgo, uploadAttachment,
  type Task, type TaskActivity, type TaskAttachment, type TaskComment, type TaskPriority, type TaskStatus,
} from '../lib/tasks'
import { ConfirmDialog } from './ConfirmDialog'
import { FilePicker } from './FilePicker'
import { DueTagBadge, PriorityBadge, StatusSelect } from './TaskBits'
import { ReassignForm } from './ReassignForm'
import { RecurringScopeDialog } from './RecurringScopeDialog'
import { applyTimeEveryDay } from '../lib/recurringScope'
import { fromDbTime, timePairError, toDbTime } from './TimeRangeInput'
import { useActiveUsers } from '../lib/useActiveUsers'
import { useMinuteTick } from '../lib/useMinuteTick'

type Tab = 'details' | 'comments' | 'files' | 'activity'

/** Slide-over showing one task with Details / Comments / Files / Activity tabs. */
export function TaskView({ taskId, onClose, onEdit, onChanged }: {
  taskId: string
  onClose: () => void
  onEdit: (t: Task) => void
  onChanged: () => void
}) {
  const { profile } = useAuth()
  useMinuteTick()   // keeps the Ongoing/Expired tag current
  const [task, setTask] = useState<Task | null>(null)
  const [comments, setComments] = useState<TaskComment[]>([])
  const [files, setFiles] = useState<TaskAttachment[]>([])
  const [activity, setActivity] = useState<TaskActivity[]>([])
  const [tab, setTab] = useState<Tab>('details')
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [reassigning, setReassigning] = useState(false)
  const users = useActiveUsers()

  const load = useCallback(async () => {
    const [t, c, f, a] = await Promise.all([
      supabase.from('tasks').select(TASK_SELECT).eq('id', taskId).maybeSingle(),
      supabase.from('task_comments').select('*, author:profiles(id, full_name)').eq('task_id', taskId).order('created_at'),
      supabase.from('task_attachments').select('*, uploader:profiles(id, full_name)').eq('task_id', taskId).order('created_at'),
      supabase.from('task_activity').select('*, actor:profiles(id, full_name)').eq('task_id', taskId).order('created_at', { ascending: false }),
    ])
    if (t.error) setError(t.error.message)
    setTask((t.data as Task) ?? null)
    setComments((c.data as TaskComment[]) ?? [])
    setFiles((f.data as TaskAttachment[]) ?? [])
    setActivity((a.data as TaskActivity[]) ?? [])
  }, [taskId])

  useEffect(() => { load() }, [load])

  // Opening a task that's new to me clears its "New" badge.
  useEffect(() => {
    if (task && profile && task.assigned_to === profile.id && !task.seen_at) {
      supabase.from('tasks').update({ seen_at: new Date().toISOString() }).eq('id', task.id)
        .then(() => { setTask({ ...task, seen_at: new Date().toISOString() }); onChanged() })
    }
  }, [task, profile, onChanged])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const refresh = async () => { await load(); onChanged() }
  const canEdit = !!task && !!profile && (task.created_by === profile.id || profile.role === 'admin')
  const mayReassign = !!task && canReassign(task, profile?.id, profile?.role === 'admin')

  const setStatus = async (s: TaskStatus) => {
    const { error } = await supabase.from('tasks').update({ status: s }).eq('id', taskId)
    if (error) setError(error.message); else refresh()
  }

  const remove = async () => {
    if (files.length) await supabase.storage.from('task-files').remove(files.map((f) => f.file_path))
    const { error } = await supabase.from('tasks').delete().eq('id', taskId)
    if (error) { setError(error.message); setConfirmDelete(false); return }
    onChanged(); onClose()
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="drawer wide" role="dialog" aria-label="Task" onMouseDown={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h3>{task ? <span className="task-no">{taskCode(task.task_no)}</span> : 'Loading…'}</h3>
          <div className="head-actions">
            {mayReassign && <button onClick={() => setReassigning(true)}><Forward size={15} /> Reassign</button>}
            {canEdit && task && <button className="secondary" onClick={() => onEdit(task)}><Pencil size={15} /> Edit</button>}
            {canEdit && <button className="danger-outline" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Delete</button>}
            <button className="icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </div>
        </div>
        <div className="tabs">
          <button className={tab === 'details' ? 'active' : ''} onClick={() => setTab('details')}>Details</button>
          <button className={tab === 'comments' ? 'active' : ''} onClick={() => setTab('comments')}>Comments <span className="tab-count">{comments.length}</span></button>
          <button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>Attachments <span className="tab-count">{files.length}</span></button>
          <button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>Activity</button>
        </div>
        <div className="drawer-body">
          {error && <div className="alert error" onClick={() => setError('')}>{error}</div>}
          {!task ? <div className="empty">Loading…</div> : (
            <>
              {tab === 'details' && (
                <Details task={task} onStatus={setStatus}
                  canPlan={canSetTime(task, profile?.id, profile?.role === 'admin')}
                  onChanged={refresh} onError={setError} />
              )}
              {tab === 'comments' && <Comments taskId={taskId} comments={comments} onChanged={refresh} onError={setError} />}
              {tab === 'files' && <Files taskId={taskId} files={files} canEdit={canEdit} onChanged={refresh} onError={setError} />}
              {tab === 'activity' && <Activity items={activity} />}
            </>
          )}
        </div>
      </div>
      {reassigning && task && (
        <ReassignForm task={task} users={users} onClose={() => setReassigning(false)}
          onSaved={() => { setReassigning(false); refresh() }} />
      )}
      {confirmDelete && task && (
        <ConfirmDialog icon={<Trash2 size={30} />} title={`Delete ${taskCode(task.task_no)}?`}
          message={task.recurring_id
            ? 'Only this day\'s copy (with its comments and attachments) will be deleted. The task keeps repeating on its schedule; to stop it, delete the recurring task from Tasks → Recurring.'
            : 'The task, its comments and attachments will be permanently deleted.'}
          confirmLabel="Yes, Delete" onConfirm={remove} onCancel={() => setConfirmDelete(false)} />
      )}
    </div>
  )
}

function Details({ task, onStatus, canPlan, onChanged, onError }: {
  task: Task; onStatus: (s: TaskStatus) => void; canPlan: boolean; onChanged: () => void; onError: (m: string) => void
}) {
  // For a recurring copy, show the schedule's start/end dates next to this day's due date.
  const [schedule, setSchedule] = useState<Pick<RecurringTask, 'start_date' | 'end_date' | 'weekdays'> | null>(null)
  useEffect(() => {
    if (!task.recurring_id) { setSchedule(null); return }
    supabase.from('recurring_tasks').select('start_date, end_date, weekdays').eq('id', task.recurring_id).maybeSingle()
      .then(({ data }) => setSchedule(data as Pick<RecurringTask, 'start_date' | 'end_date' | 'weekdays'> | null))
  }, [task.recurring_id])

  return (
    <>
      <div className="fgrid">
        <Cell label="Task Title" span={6}><span className="fcell-title">{task.title}</span></Cell>
        <Cell label="Assigned By" span={3}>
          {task.assigner?.full_name ?? '—'}
          {task.created_by !== task.assigned_by && task.creator && <small className="muted"> · created by {task.creator.full_name}</small>}
        </Cell>
        <Cell label="Assigned To" span={3}>{task.assignee?.full_name ?? '—'}</Cell>

        <Cell label="Created Date" span={3}>
          {formatDate(task.created_at)} <small className="muted">({timeAgo(task.created_at)})</small>
        </Cell>
        <Cell label="Completed Date" span={3}>
          {task.completed_at
            ? <>{formatDate(task.completed_at)} <small className="muted">({timeAgo(task.completed_at)})</small></>
            : <span className="muted">Not completed yet</span>}
        </Cell>

        <Cell label="Type" span={2}>{task.task_type === 'recurring' ? '↻ Recurring' : TYPE_LABELS[task.task_type]}</Cell>
        <Cell label="Priority" span={2}><PriorityBadge priority={task.priority} /></Cell>
        <Cell label="Status" span={2}><StatusSelect value={task.status} onChange={onStatus} /></Cell>

        <DateTimeEditor task={task} editable={canPlan} schedule={schedule} onChanged={onChanged} onError={onError} />
      </div>
      <div className="form-section">Description</div>
      {task.description ? <div className="desc">{task.description}</div> : <p className="muted">No description.</p>}
    </>
  )
}

function Cell({ label, span, children }: { label: string; span: number; children: React.ReactNode }) {
  return (
    <div className={`fcell span-${span}`}>
      <div className="fcell-label">{label}</div>
      <div className="fcell-value">{children}</div>
    </div>
  )
}

/** Due date + start/end time. Editable in place for the assignee/creator/admin; plain text for others. */
function DateTimeEditor({ task, editable, schedule, onChanged, onError }: {
  task: Task
  editable: boolean
  schedule: Pick<RecurringTask, 'start_date' | 'end_date' | 'weekdays'> | null
  onChanged: () => void
  onError: (m: string) => void
}) {
  const { profile } = useAuth()
  const recurring = !!task.recurring_id
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [date, setDate] = useState(task.due_date ?? '')
  const [from, setFrom] = useState(fromDbTime(task.start_time))
  const [to, setTo] = useState(fromDbTime(task.end_time))
  const [saved, setSaved] = useState(false)
  const timeErr = timePairError(from, to)

  useEffect(() => { setDate(task.due_date ?? ''); setFrom(fromDbTime(task.start_time)); setTo(fromDbTime(task.end_time)) },
    [task.due_date, task.start_time, task.end_time])

  const flashSaved = () => { setSaved(true); window.setTimeout(() => setSaved(false), 1500) }

  const save = async (patch: Record<string, unknown>) => {
    const { error } = await supabase.from('tasks').update(patch).eq('id', task.id)
    if (error) { onError(error.message); return }
    flashSaved()
    onChanged()
  }

  const changeDate = (d: string) => {
    setDate(d)
    if (!d && task.task_type === 'adhoc') return onError('Ad hoc tasks need a due date')
    if (d !== (task.due_date ?? '')) save({ due_date: d || null })
  }

  const timeDirty = toDbTime(from) !== task.start_time || toDbTime(to) !== task.end_time

  const changeTime = (f: string, t: string) => {
    // Picking a start time on an empty task suggests a 1-hour slot.
    if (f && !t && !to) t = plusHour(f)
    setFrom(f); setTo(t)
    if (recurring || timePairError(f, t)) return          // recurring: saved via "Save time" + scope question
    if (toDbTime(f) !== task.start_time || toDbTime(t) !== task.end_time) save({ start_time: toDbTime(f), end_time: toDbTime(t) })
  }

  const saveRecurring = async (which: 'only' | 'all') => {
    setBusy(true)
    try {
      if (which === 'all') {
        await applyTimeEveryDay(task.recurring_id!, task.occurrence_date ?? task.due_date ?? '', toDbTime(from), toDbTime(to))
        flashSaved(); onChanged()
      } else await save({ start_time: toDbTime(from), end_time: toDbTime(to) })
    } catch (e) { onError(e instanceof Error ? e.message : String(e)) }
    setBusy(false); setAsking(false)
  }

  return (
    <>
      <Cell label={recurring ? 'Due Date (this day)' : 'Due Date'} span={recurring ? 2 : 6}>
        <div className="inline-edit">
          {editable
            ? <input type="date" value={date} onChange={(e) => changeDate(e.target.value)} aria-label="Due date" />
            : <span className={isOverdue(task) ? 'overdue-text' : ''}>{formatDate(task.due_date)}</span>}
          <DueTagBadge task={task} />
          {saved && <span className="saved-tick"><Check size={14} /> Saved</span>}
        </div>
      </Cell>
      {recurring && (
        <>
          <Cell label="Recurring Start Date" span={2}>{schedule ? formatDate(schedule.start_date) : '—'}</Cell>
          <Cell label="Recurring End Date" span={2}>{schedule ? (schedule.end_date ? formatDate(schedule.end_date) : 'Until stopped') : '—'}</Cell>
        </>
      )}

      <Cell label="Start Time" span={3}>
        {editable
          ? <input type="time" step={300} value={from} onChange={(e) => changeTime(e.target.value, to)} aria-label="Start time" />
          : task.start_time ? formatTime(task.start_time) : <span className="muted">Not set</span>}
      </Cell>
      <Cell label="End Time" span={3}>
        {editable ? (
          <div className="inline-edit">
            <input type="time" step={300} value={to} onChange={(e) => changeTime(from, e.target.value)} aria-label="End time" />
            {(from || to) && <button type="button" className="link" onClick={() => changeTime('', '')}>Clear</button>}
          </div>
        ) : task.end_time ? formatTime(task.end_time) : <span className="muted">Not set</span>}
      </Cell>
      {editable && ((from || to) && timeErr || (recurring && timeDirty && !timeErr)) && (
        <div className="fcell span-6">
          {(from || to) && timeErr && <small className="overdue-text">{timeErr}</small>}
          {recurring && timeDirty && !timeErr && (
            <div className="inline-edit">
              <button type="button" onClick={() => setAsking(true)}>Save time</button>
              <button type="button" className="link" onClick={() => { setFrom(fromDbTime(task.start_time)); setTo(fromDbTime(task.end_time)) }}>Undo</button>
            </div>
          )}
        </div>
      )}
      {asking && (
        <RecurringScopeDialog canAll={profile?.role === 'admin' || task.created_by === profile?.id} busy={busy}
          onOnly={() => saveRecurring('only')} onAll={() => saveRecurring('all')} onCancel={() => setAsking(false)} />
      )}
    </>
  )
}

function plusHour(t: string) {
  const [h, m] = t.split(':').map(Number)
  return h >= 23 ? '23:59' : `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function Comments({ taskId, comments, onChanged, onError }: {
  taskId: string; comments: TaskComment[]; onChanged: () => void; onError: (m: string) => void
}) {
  const { profile } = useAuth()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  const send = async () => {
    if (!profile || !body.trim()) return
    setBusy(true)
    const { error } = await supabase.from('task_comments').insert({ task_id: taskId, author_id: profile.id, body: body.trim() })
    setBusy(false)
    if (error) return onError(error.message)
    setBody(''); onChanged()
  }

  const remove = async (id: string) => {
    const { error } = await supabase.from('task_comments').delete().eq('id', id)
    if (error) onError(error.message); else onChanged()
  }

  return (
    <>
      {comments.length === 0 && <p className="muted">No comments yet. Start the conversation below.</p>}
      {comments.map((c) => (
        <div className="comment" key={c.id}>
          <div className="avatar">{initials(c.author?.full_name ?? '?')}</div>
          <div className="comment-body">
            <div className="comment-meta">
              <b>{c.author?.full_name ?? 'Unknown'}</b> {timeAgo(c.created_at)}
              {(c.author_id === profile?.id || profile?.role === 'admin') && (
                <button className="link danger" onClick={() => remove(c.id)}>Delete</button>
              )}
            </div>
            <div className="comment-text">{c.body}</div>
          </div>
        </div>
      ))}
      <div className="composer">
        <textarea rows={2} placeholder="Write a comment…" value={body} onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() }} />
        <button onClick={send} disabled={busy || !body.trim()}><Send size={16} /> Send</button>
      </div>
      <p className="muted small">Tip: press ⌘/Ctrl + Enter to send.</p>
    </>
  )
}

function Files({ taskId, files, canEdit, onChanged, onError }: {
  taskId: string; files: TaskAttachment[]; canEdit: boolean; onChanged: () => void; onError: (m: string) => void
}) {
  const { profile } = useAuth()
  const [picked, setPicked] = useState<File[]>([])
  const [busy, setBusy] = useState(false)

  const upload = async () => {
    if (!profile) return
    setBusy(true)
    try {
      for (const f of picked) await uploadAttachment(taskId, profile.id, f)
      setPicked([]); onChanged()
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const download = async (f: TaskAttachment) => {
    const { data, error } = await supabase.storage.from('task-files').createSignedUrl(f.file_path, 60, { download: f.file_name })
    if (error) return onError(error.message)
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  const remove = async (f: TaskAttachment) => {
    await supabase.storage.from('task-files').remove([f.file_path])
    const { error } = await supabase.from('task_attachments').delete().eq('id', f.id)
    if (error) onError(error.message); else onChanged()
  }

  return (
    <>
      {files.length === 0 && <p className="muted">No attachments yet.</p>}
      {files.map((f) => (
        <div className="file-row" key={f.id}>
          <div className="file-icon"><FileText size={18} /></div>
          <div className="file-info">
            <b title={f.file_name}>{f.file_name}</b>
            <small>{formatSize(f.size_bytes)} · {f.uploader?.full_name ?? 'Unknown'} · {timeAgo(f.created_at)}</small>
          </div>
          <button className="icon" title="Download" onClick={() => download(f)}><Download size={17} /></button>
          {(f.uploaded_by === profile?.id || canEdit) && (
            <button className="icon" title="Delete" onClick={() => remove(f)}><Trash2 size={17} /></button>
          )}
        </div>
      ))}
      <FilePicker files={picked} onChange={setPicked} onError={onError} label="Add files (max 10 MB each)" />
      {picked.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <button onClick={upload} disabled={busy}>{busy ? 'Uploading…' : `Upload ${picked.length} file${picked.length > 1 ? 's' : ''}`}</button>
        </div>
      )}
    </>
  )
}

const statusName = (s: string | null) => (s === 'blocked' ? 'Blocked' : STATUS_LABELS[s as TaskStatus] ?? s)

function describe(a: TaskActivity) {
  const who = a.actor?.full_name ?? 'Someone'
  switch (a.action) {
    case 'created': return <><b>{who}</b> created the task</>
    case 'status': return <><b>{who}</b> changed status from <b>{statusName(a.old_value)}</b> to <b>{statusName(a.new_value)}</b></>
    case 'assigned_to': return <><b>{who}</b> reassigned the task from <b>{a.old_value}</b> to <b>{a.new_value}</b></>
    case 'due_date': return <><b>{who}</b> changed due date from <b>{formatDate(a.old_value)}</b> to <b>{formatDate(a.new_value)}</b></>
    case 'priority': return <><b>{who}</b> changed priority from <b>{PRIORITY_LABELS[a.old_value as TaskPriority] ?? a.old_value}</b> to <b>{PRIORITY_LABELS[a.new_value as TaskPriority] ?? a.new_value}</b></>
    case 'title': return <><b>{who}</b> renamed the task to <b>{a.new_value}</b></>
    case 'comment': return <><b>{who}</b> commented: “{a.new_value}”</>
    case 'attachment': return <><b>{who}</b> attached <b>{a.new_value}</b></>
    case 'comment_deleted': return <><b>{who}</b> deleted a comment: <span className="muted">“{a.old_value}”</span></>
    case 'attachment_deleted': return <><b>{who}</b> deleted the attachment <b>{a.old_value}</b></>
    default: return <><b>{who}</b> {a.action}</>
  }
}

function Activity({ items }: { items: TaskActivity[] }) {
  if (!items.length) return <p className="muted">No activity yet.</p>
  return (
    <ul className="timeline">
      {items.map((a) => <li key={a.id}>{describe(a)}<small>{timeAgo(a.created_at)}</small></li>)}
    </ul>
  )
}

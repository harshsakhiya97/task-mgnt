import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pause, Pencil, Play, Repeat, Trash2 } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { formatDate, formatTimeRange, PRIORITY_LABELS, RECURRING_SELECT, todayStr, weekdayNames, type RecurringTask, type TaskPriority } from '../lib/tasks'
import type { Profile } from '../lib/types'
import { ConfirmDialog } from './ConfirmDialog'
import { Pagination } from './Pagination'
import { RecurringForm } from './RecurringForm'
import { PriorityBadge } from './TaskBits'

export type RState = '' | 'active' | 'paused' | 'ended'

/** Is the schedule running, paused, or past its end date? */
export function stateOf(r: RecurringTask, today: string): Exclude<RState, ''> {
  if (r.end_date && r.end_date < today) return 'ended'
  return r.is_active ? 'active' : 'paused'
}
const STATE_LABELS = { active: 'Active', paused: 'Paused', ended: 'Ended' } as const

/** Recurring schedules the user created, is assigned, or (admins) all of them. */
export type RecurringCounts = { total: number; active: number; paused: number; ended: number }

export function RecurringList({ users, reloadKey, search, state, onState, onCount, onCounts }: {
  users: Profile[]; reloadKey: number; search: string
  state: RState; onState: (s: RState) => void
  onCount: (n: number) => void
  /** Counts for the whole tab (before filters), for the header cards. */
  onCounts: (c: RecurringCounts) => void
}) {
  const { profile } = useAuth()
  const [items, setItems] = useState<RecurringTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<RecurringTask | null>(null)
  const [deleting, setDeleting] = useState<RecurringTask | null>(null)
  const [priority, setPriority] = useState<'' | TaskPriority>('')
  const [assignee, setAssignee] = useState('')
  const [creator, setCreator] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('recurring_tasks').select(RECURRING_SELECT).order('created_at', { ascending: false })
    if (error) setError(error.message)
    setItems((data as RecurringTask[]) ?? [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load, reloadKey])

  const today = todayStr()
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((r) => {
      if (state && stateOf(r, today) !== state) return false
      if (priority && r.priority !== priority) return false
      if (assignee && r.assigned_to !== assignee) return false
      if (creator && r.created_by !== creator) return false
      return !q || r.title.toLowerCase().includes(q)
    })
  }, [items, search, state, priority, assignee, creator, today])
  useEffect(() => { onCount(visible.length) }, [visible.length, onCount])
  useEffect(() => {
    const c = { total: items.length, active: 0, paused: 0, ended: 0 }
    for (const r of items) c[stateOf(r, today)]++
    onCounts(c)
  }, [items, today, onCounts])
  useEffect(() => { setPage(1) }, [search, state, priority, assignee, creator, pageSize])
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize))
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])
  const rows = visible.slice((page - 1) * pageSize, page * pageSize)

  const canManage = (r: RecurringTask) => profile?.role === 'admin' || r.created_by === profile?.id

  const toggle = async (r: RecurringTask) => {
    const { error } = await supabase.from('recurring_tasks').update({ is_active: !r.is_active }).eq('id', r.id)
    if (error) setError(error.message); else load()
  }
  const remove = async () => {
    if (!deleting) return
    const { error } = await supabase.from('recurring_tasks').delete().eq('id', deleting.id)
    setDeleting(null)
    if (error) setError(error.message); else load()
  }

  return (
    <>
      <div className="filters">
        <select className="pill-select" value={state} onChange={(e) => onState(e.target.value as RState)}>
          <option value="">All Statuses</option>
          {Object.entries(STATE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="pill-select" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority | '')}>
          <option value="">Select Priority</option>
          {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="pill-select" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Select Assigned To</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
        <select className="pill-select" value={creator} onChange={(e) => setCreator(e.target.value)}>
          <option value="">Select Created By</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
      </div>
      {error && <div className="alert error" style={{ margin: 16 }} onClick={() => setError('')}>{error}</div>}
      <div className="table-scroll">
      {loading ? <div className="empty">Loading…</div> : visible.length === 0 ? (
        <div className="empty"><Repeat size={40} />{items.length
          ? <><b>No recurring tasks match</b>Try changing the search or filters.</>
          : <><b>No recurring tasks yet</b>Click "Add Task" and choose "Recurring" to set one up.</>}</div>
      ) : (
        <table>
          <thead>
            <tr><th>Sr. No.</th><th>Title</th><th>Assigned To</th><th>Repeats</th><th>From</th><th>Until</th><th>Priority</th><th>Status</th><th>Created By</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={r.is_active ? '' : 'inactive'}>
                <td>{(page - 1) * pageSize + i + 1}</td>
                <td><div className="task-title" title={r.title}>{r.title}</div></td>
                <td>{r.assignee?.full_name ?? '—'}</td>
                <td>{weekdayNames(r.weekdays)}{r.start_time && <div className="time-text">{formatTimeRange(r.start_time, r.end_time)}</div>}</td>
                <td>{formatDate(r.start_date)}</td>
                <td>{r.end_date ? formatDate(r.end_date) : 'Until stopped'}</td>
                <td><PriorityBadge priority={r.priority} /></td>
                <td>{(() => { const st = stateOf(r, today); return <span className={`badge ${st === 'active' ? 'active' : 'paused'}`}>{STATE_LABELS[st]}</span> })()}</td>
                <td>{r.creator?.full_name ?? '—'}</td>
                <td className="actions">
                  {canManage(r) && <>
                    <button className="icon" title="Edit" onClick={() => setEditing(r)}><Pencil size={17} /></button>
                    <button className="icon" title={r.is_active ? 'Pause' : 'Resume'} onClick={() => toggle(r)}>{r.is_active ? <Pause size={17} /> : <Play size={17} />}</button>
                    <button className="icon" title="Delete" onClick={() => setDeleting(r)}><Trash2 size={17} /></button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      </div>
      <Pagination page={page} pageSize={pageSize} total={visible.length} onPage={setPage} onPageSize={setPageSize} />
      {editing && <RecurringForm item={editing} users={users} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
      {deleting && (
        <ConfirmDialog icon={<Trash2 size={30} />} title={`Delete "${deleting.title}"?`}
          message="No new copies will be created. Copies already created stay in the task list."
          confirmLabel="Yes, Delete" onConfirm={remove} onCancel={() => setDeleting(null)} />
      )}
    </>
  )
}

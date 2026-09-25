import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, CalendarCheck, CheckCircle2, CircleDot, CirclePause, CirclePlay, ClipboardList, Flag, Hourglass, Plus, Repeat, Search, Trash2 } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Pagination } from '../components/Pagination'
import { RecurringList, type RecurringCounts, type RState } from '../components/RecurringList'
import { StatCard } from '../components/StatCard'
import { TaskForm, type TaskSaved } from '../components/TaskForm'
import { TaskTable, type PersonColumn } from '../components/TaskTable'
import { TaskView } from '../components/TaskView'
import { supabase } from '../lib/supabase'
import { addDays, dueTag, fetchTasks, isGivenBy, isNewFor, PRIORITY_LABELS, STATUS_LABELS, taskCode, todayStr, TYPE_LABELS, type Task, type TaskPriority, type TaskStatus, type TaskType } from '../lib/tasks'
import { useActiveUsers } from '../lib/useActiveUsers'
import { useMinuteTick } from '../lib/useMinuteTick'

type View = 'mine' | 'given' | 'all' | 'recurring'
type Due = '' | 'ongoing' | 'expired' | 'completed' | 'today' | 'week'
type StatusFilter = '' | TaskStatus | 'open'

const VIEW_LABELS: Record<View, string> = { mine: 'Assigned to Me', given: 'Assigned by Me', all: 'All Tasks', recurring: 'Recurring' }

export function Tasks() {
  const { profile } = useAuth()
  useMinuteTick()   // keeps Ongoing/Expired current
  const users = useActiveUsers()
  const [params, setParams] = useSearchParams()
  const isAdmin = profile?.role === 'admin'
  const pv = params.get('view')
  const view: View = pv === 'given' ? 'given' : pv === 'recurring' ? 'recurring' : pv === 'all' && isAdmin ? 'all' : 'mine'

  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('open')
  const [priority, setPriority] = useState<'' | TaskPriority>('')
  const [due, setDue] = useState<Due>((params.get('due') as Due) || '')
  const [person, setPerson] = useState('')
  const [type, setType] = useState<'' | TaskType>('')
  const [recurringKey, setRecurringKey] = useState(0)
  const [recurringCount, setRecurringCount] = useState(0)
  const [recurringCounts, setRecurringCounts] = useState<RecurringCounts>({ total: 0, active: 0, paused: 0, ended: 0 })
  const [rState, setRState] = useState<RState>('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [viewing, setViewing] = useState<string | null>(params.get('task'))
  const [deleting, setDeleting] = useState<Task | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const taskParam = params.get('task')
  useEffect(() => { setViewing(taskParam) }, [taskParam])

  const load = useCallback(async () => {
    try { setTasks(await fetchTasks()) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const setView = (v: View) => { setParams(v === 'mine' ? {} : { view: v }); setPerson('') }

  const inView = useMemo(() => tasks.filter((t) =>
    view === 'mine' ? t.assigned_to === profile?.id : view === 'given' ? isGivenBy(t, profile?.id) : true,
  ), [tasks, view, profile?.id])

  const newCount = tasks.filter((t) => isNewFor(t, profile?.id)).length

  // Header cards: counts for the whole tab (before filters). Clicking a card applies that filter.
  const counts = {
    total: inView.length,
    todo: inView.filter((t) => t.status === 'todo').length,
    inProgress: inView.filter((t) => t.status === 'in_progress').length,
    done: inView.filter((t) => t.status === 'done').length,
    expired: inView.filter((t) => dueTag(t) === 'expired').length,
    today: inView.filter((t) => t.status !== 'done' && t.due_date === todayStr()).length,
    urgent: inView.filter((t) => t.status !== 'done' && t.priority === 'urgent').length,
  }
  const quick = (s: StatusFilter, d: Due, p: '' | TaskPriority = '') => { setStatus(s); setDue(d); setPriority(p) }
  const isQuick = (s: StatusFilter, d: Due, p: '' | TaskPriority = '') => status === s && due === d && priority === p
  const today = todayStr()
  const weekEnd = addDays(today, 6)
  const visible = inView.filter((t) => {
    if (status === 'open' && t.status === 'done' && due !== 'completed') return false
    if (status && status !== 'open' && t.status !== status) return false
    if (priority && t.priority !== priority) return false
    if ((due === 'ongoing' || due === 'expired' || due === 'completed') && dueTag(t) !== due) return false
    if (type && t.task_type !== type) return false
    if (due === 'today' && t.due_date !== today) return false
    if (due === 'week' && !(t.due_date && t.due_date >= today && t.due_date <= weekEnd)) return false
    if (person) {
      const match = view === 'mine' ? t.assigned_by === person
        : view === 'given' ? t.assigned_to === person
        : t.assigned_to === person || t.assigned_by === person
      if (!match) return false
    }
    const q = search.trim().toLowerCase()
    return !q || t.title.toLowerCase().includes(q) || taskCode(t.task_no).toLowerCase().includes(q)
      || (t.description ?? '').toLowerCase().includes(q)
  })

  if (view === 'mine') visible.sort((x, y) => Number(isNewFor(y, profile?.id)) - Number(isNewFor(x, profile?.id)))

  useEffect(() => { setPage(1) }, [view, search, status, priority, due, person, type, pageSize])
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize))
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])
  const rows = visible.slice((page - 1) * pageSize, page * pageSize)

  const changeStatus = async (t: Task, s: TaskStatus) => {
    setTasks((all) => all.map((x) => (x.id === t.id ? { ...x, status: s } : x)))   // instant feedback
    const { error } = await supabase.from('tasks').update({ status: s }).eq('id', t.id)
    if (error) { setError(error.message); load() }
  }

  const removeTask = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    // Remove its files from storage first (the rows go with the task).
    const { data: files } = await supabase.from('task_attachments').select('file_path').eq('task_id', deleting.id)
    if (files?.length) await supabase.storage.from('task-files').remove(files.map((f) => f.file_path))
    const { error } = await supabase.from('tasks').delete().eq('id', deleting.id)
    setDeleteBusy(false); setDeleting(null)
    if (error) setError(error.message); else load()
  }

  const openTask = (id: string | null) => {
    setViewing(id)
    const next = new URLSearchParams(params)
    if (id) next.set('task', id); else next.delete('task')
    setParams(next, { replace: true })
  }

  const personCol: PersonColumn = view === 'mine' ? 'assigner' : 'both'
  const personLabel = view === 'mine' ? 'Assigned By' : view === 'given' ? 'Assigned To' : 'Person'

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Task Management</h2>
          <p>Assign work to anyone, track status and due dates.</p>
        </div>
      </div>

      {error && <div className="alert error" onClick={() => setError('')}>{error}</div>}

      {view === 'recurring' ? (
        <div className="stats tab-stats">
          <StatCard icon={Repeat} tone="navy" value={recurringCounts.total} label="Total Recurring" onClick={() => setRState('')} active={rState === ''} />
          <StatCard icon={CirclePlay} tone="green" value={recurringCounts.active} label="Active" onClick={() => setRState('active')} active={rState === 'active'} />
          <StatCard icon={CirclePause} tone="yellow" value={recurringCounts.paused} label="Paused" onClick={() => setRState('paused')} active={rState === 'paused'} />
          <StatCard icon={Flag} tone="purple" value={recurringCounts.ended} label="Ended" onClick={() => setRState('ended')} active={rState === 'ended'} />
        </div>
      ) : (
        <div className="stats tab-stats">
          <StatCard icon={ClipboardList} tone="navy" value={counts.total} label="Total Tasks" onClick={() => quick('', '')} active={isQuick('', '')} />
          <StatCard icon={CircleDot} tone="blue" value={counts.todo} label="To Do" onClick={() => quick('todo', '')} active={isQuick('todo', '')} />
          <StatCard icon={Hourglass} tone="yellow" value={counts.inProgress} label="In Progress" onClick={() => quick('in_progress', '')} active={isQuick('in_progress', '')} />
          <StatCard icon={CheckCircle2} tone="green" value={counts.done} label="Completed" onClick={() => quick('done', '')} active={isQuick('done', '')} />
          <StatCard icon={AlertTriangle} tone="red" value={counts.expired} label="Expired" onClick={() => quick('open', 'expired')} active={isQuick('open', 'expired')} />
          <StatCard icon={CalendarCheck} tone="teal" value={counts.today} label="Due Today" onClick={() => quick('open', 'today')} active={isQuick('open', 'today')} />
          <StatCard icon={Flag} tone="orange" value={counts.urgent} label="Urgent (open)" onClick={() => quick('open', '', 'urgent')} active={isQuick('open', '', 'urgent')} />
        </div>
      )}

      <div className="panel">
        <div className="panel-toolbar">
          <div className="view-tabs">
            {(['mine', 'given', ...(isAdmin ? ['all'] : []), 'recurring'] as View[]).map((v) => (
              <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
                {VIEW_LABELS[v]}{v === 'mine' && newCount > 0 && <span className="new-count">{newCount} new</span>}
              </button>
            ))}
          </div>
          <span className="count-pill">{view === 'recurring' ? recurringCount : visible.length} Tasks</span>
          <span className="spacer" />
          <div className="search-box">
            <Search size={16} />
            <input placeholder={view === 'recurring' ? 'Search title' : 'Search title or TM-number'}
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button onClick={() => setCreating(true)}><Plus size={18} /> Add Task</button>
        </div>
        {view === 'recurring' ? (
          <RecurringList users={users} reloadKey={recurringKey} search={search} state={rState} onState={setRState}
            onCount={setRecurringCount} onCounts={setRecurringCounts} />
        ) : <>
        <div className="filters">
          <select className="pill-select" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="open">Open Tasks</option>
            <option value="">All Statuses</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="pill-select" value={due} onChange={(e) => setDue(e.target.value as Due)}>
            <option value="">Any Due Status</option>
            <option value="ongoing">Ongoing</option>
            <option value="expired">Expired</option>
            <option value="completed">Completed</option>
            <option value="today">Due Today</option>
            <option value="week">Due This Week</option>
          </select>
          <select className="pill-select" value={type} onChange={(e) => setType(e.target.value as TaskType | '')}>
            <option value="">All Types</option>
            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="pill-select" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority | '')}>
            <option value="">Select Priority</option>
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="pill-select" value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">{`Select ${personLabel}`}</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </div>
        <div className="table-scroll">
          {loading ? <div className="empty">Loading…</div> : visible.length === 0 ? (
            <div className="empty">
              <ClipboardList size={40} />
              <b>No tasks here</b>
              {inView.length ? 'Try changing the filters.' : view === 'mine' ? 'Nothing assigned to you yet.' : 'Click "Add Task" to assign work.'}
            </div>
          ) : (
            <TaskTable tasks={rows} offset={(page - 1) * pageSize} person={personCol}
              onOpen={(t) => openTask(t.id)} onStatus={changeStatus}
              onDelete={view !== 'mine' ? setDeleting : undefined} />
          )}
        </div>
        <Pagination page={page} pageSize={pageSize} total={visible.length} onPage={setPage} onPageSize={setPageSize} />
        </>}
      </div>

      {creating && <TaskForm users={users} onClose={() => setCreating(false)} onSaved={(r: TaskSaved) => {
        setCreating(false); load()
        if (r.recurring) { setRecurringKey((k) => k + 1); setView('recurring') } else if (r.taskId) openTask(r.taskId)
      }} />}
      {viewing && !editing && (
        <TaskView taskId={viewing} onClose={() => openTask(null)} onEdit={setEditing} onChanged={load} />
      )}
      {deleting && (
        <ConfirmDialog icon={<Trash2 size={30} />} title={`Delete ${taskCode(deleting.task_no)}?`}
          message={deleting.recurring_id
            ? 'Only this day\'s copy (with its comments and attachments) will be deleted. The task keeps repeating on its schedule; to stop it, delete the recurring task from the Recurring tab.'
            : 'The task, its comments and attachments will be permanently deleted.'}
          confirmLabel="Yes, Delete" busy={deleteBusy} onConfirm={removeTask} onCancel={() => setDeleting(null)} />
      )}
      {editing && (
        <TaskForm task={editing} users={users} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }} />
      )}
    </>
  )
}

import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlarmClock, ArrowLeft, CheckCircle2, ChevronRight, Play, RefreshCw, Repeat, Search, UserX } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { addDays, fetchTasks, isOverdue, STATUS_LABELS, taskCode, timeLength, formatTimeRange, todayStr, type Task, type TaskStatus } from '../lib/tasks'
import { useActiveUsers } from '../lib/useActiveUsers'
import { useMinuteTick } from '../lib/useMinuteTick'
import { initials } from '../lib/initials'
import type { Team } from '../lib/types'
import { PriorityBadge } from '../components/TaskBits'
import { TaskView } from '../components/TaskView'
import { TaskForm } from '../components/TaskForm'

type StatusFilter = 'open' | 'todo' | 'in_progress' | 'done' | 'all'
type DueFilter = 'any' | 'today_overdue' | 'today' | 'overdue' | 'week'

const STATUS_OPTIONS: [StatusFilter, string][] = [['open', 'Open'], ['todo', 'To Do'], ['in_progress', 'In Progress'], ['done', 'Done'], ['all', 'All']]
const DUE_OPTIONS: [DueFilter, string][] = [['any', 'Any due date'], ['today_overdue', 'Today & overdue'], ['today', 'Due today'], ['overdue', 'Overdue'], ['week', 'Due this week']]
const UNASSIGNED = '__unassigned'
/** One person's board: a column per status. Done shows the last 7 days (by completion). */
const STATUS_COLS: TaskStatus[] = ['todo', 'in_progress', 'done']
const ST = 'st:'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "01 Oct" from "2026-10-01". */
const shortDate = (d: string) => `${d.slice(8, 10)} ${MON[Number(d.slice(5, 7)) - 1]}`
/** "16:07", or "30 Sep 16:07" when it wasn't today. */
const clock = (iso: string) => {
  const d = new Date(iso)
  const t = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
  return todayStr(d) === todayStr() ? t : `${shortDate(todayStr(d))} ${t}`
}

/**
 * Admin → Team Board: every person's tasks as cards in their own column (like a daily work board).
 * Filter by status / due date / team; drag a card onto another person to reassign it.
 * Click a person's name → their own board (?person=id): To Do / In Progress / Done columns; drag between them to change status.
 */
export function TeamBoard() {
  useMinuteTick()
  const users = useActiveUsers()
  const [params, setParams] = useSearchParams()
  const personId = params.get('person')
  const openPerson = (id: string | null) => { const n = new URLSearchParams(params); if (id) n.set('person', id); else n.delete('person'); setParams(n); window.scrollTo(0, 0) }
  const [tasks, setTasks] = useState<Task[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [started, setStarted] = useState<Record<string, string>>({})   // task id → when it went In Progress
  const [timing, setTiming] = useState<Set<string>>(new Set())         // tasks with a running edit timer (2.0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<StatusFilter>('open')
  const [due, setDue] = useState<DueFilter>('any')
  const [team, setTeam] = useState('')
  const [search, setSearch] = useState('')
  const [viewing, setViewing] = useState<string | null>(null)
  const [editing, setEditing] = useState<Task | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null)

  const load = useCallback(async () => {
    try {
      const all = await fetchTasks()
      setTasks(all)
      // When did each task in progress start? (latest move to In Progress in its activity log)
      const ids = all.filter((t) => t.status === 'in_progress').map((t) => t.id)
      if (ids.length) {
        const { data } = await supabase.from('task_activity').select('task_id, created_at')
          .eq('action', 'status').eq('new_value', 'in_progress').in('task_id', ids).order('created_at')
        const map: Record<string, string> = {}
        for (const r of (data ?? []) as { task_id: string; created_at: string }[]) map[r.task_id] = r.created_at
        setStarted(map)
      } else setStarted({})
      const { data: run } = await supabase.from('task_time_entries').select('task_id').is('ended_at', null)
      setTiming(new Set(((run ?? []) as { task_id: string }[]).map((r) => r.task_id)))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { supabase.from('teams').select('id, name').order('name').then(({ data }) => setTeams((data as Team[]) ?? [])) }, [])
  // Keep the board fresh while it's open on a screen.
  useEffect(() => { const t = setInterval(load, 60_000); return () => clearInterval(t) }, [load])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t) }, [toast])

  const today = todayStr()
  const weekEnd = addDays(today, 6)
  const q = search.trim().toLowerCase()

  const visible = useMemo(() => tasks.filter((t) => {
    if (status === 'open' && t.status === 'done') return false
    if (status !== 'open' && status !== 'all' && t.status !== status) return false
    const d = t.due_date
    if (due === 'today' && d !== today) return false
    if (due === 'overdue' && !isOverdue(t)) return false
    if (due === 'today_overdue' && !(d === today || isOverdue(t))) return false
    if (due === 'week' && !(d && d >= today && d <= weekEnd)) return false
    if (q && !t.title.toLowerCase().includes(q) && !taskCode(t.task_no).toLowerCase().includes(q)) return false
    return true
  }), [tasks, status, due, q, today, weekEnd])

  const people = users.filter((u) => !team || u.team_id === team)
  const byPerson = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of visible) {
      const k = t.assigned_to ?? UNASSIGNED
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(t)
    }
    // In progress first, then by due date (overdue first), then newest.
    const rank = (t: Task) => (t.status === 'in_progress' ? 0 : t.status === 'done' ? 2 : 1)
    for (const list of m.values()) list.sort((a, b) => rank(a) - rank(b) || (a.due_date ?? '9').localeCompare(b.due_date ?? '9') || b.task_no - a.task_no)
    return m
  }, [visible])
  const doneToday = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of tasks) if (t.status === 'done' && t.assigned_to && t.completed_at && todayStr(new Date(t.completed_at)) === today) m.set(t.assigned_to, (m.get(t.assigned_to) ?? 0) + 1)
    return m
  }, [tasks, today])

  const unassigned = byPerson.get(UNASSIGNED) ?? []

  // ---- drag & drop (reassign) ----
  const reassign = async (task: Task, to: string) => {
    const from = task.assigned_to
    if (from === to) return
    const toName = users.find((u) => u.id === to)?.full_name ?? 'them'
    setTasks((all) => all.map((x) => (x.id === task.id ? { ...x, assigned_to: to, assignee: { id: to, full_name: toName } } : x)))
    const { error } = await supabase.from('tasks').update({ assigned_to: to }).eq('id', task.id)
    if (error) { setError(error.message); load(); return }
    load()
    setToast({
      text: `${taskCode(task.task_no)} moved to ${toName}`,
      undo: from ? async () => {
        setToast(null)
        const { error: e2 } = await supabase.from('tasks').update({ assigned_to: from }).eq('id', task.id)
        if (e2) setError(e2.message)
        load()
      } : undefined,
    })
  }
  const changeStatus = async (task: Task, to: TaskStatus) => {
    const from = task.status
    if (from === to) return
    setTasks((all) => all.map((x) => (x.id === task.id ? { ...x, status: to, completed_at: to === 'done' ? new Date().toISOString() : null } : x)))
    if (to === 'in_progress') setStarted((m) => ({ ...m, [task.id]: new Date().toISOString() }))
    const { error } = await supabase.from('tasks').update({ status: to }).eq('id', task.id)
    if (error) { setError(error.message); load(); return }
    load()
    setToast({
      text: `${taskCode(task.task_no)} → ${STATUS_LABELS[to]}`,
      undo: async () => {
        setToast(null)
        const { error: e2 } = await supabase.from('tasks').update({ status: from }).eq('id', task.id)
        if (e2) setError(e2.message)
        load()
      },
    })
  }
  const onDragStart = (e: DragEvent, t: Task) => { setDragId(t.id); e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move' }
  const onDragOver = (e: DragEvent, col: string) => { if (!dragId || col === UNASSIGNED) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (overCol !== col) setOverCol(col) }
  const onDrop = (e: DragEvent, col: string) => {
    e.preventDefault(); setOverCol(null)
    const id = e.dataTransfer.getData('text/plain') || dragId
    setDragId(null)
    const t = tasks.find((x) => x.id === id)
    if (!t || col === UNASSIGNED) return
    if (col.startsWith(ST)) changeStatus(t, col.slice(ST.length) as TaskStatus)
    else reassign(t, col)
  }

  const card = (t: Task) => {
    const late = isOverdue(t)
    const len = t.start_time && t.end_time ? timeLength(t.start_time.slice(0, 5), t.end_time.slice(0, 5)) : ''
    return (
      <div key={t.id} className={`tb-card st-${t.status} ${dragId === t.id ? 'dragging' : ''}`} draggable
        onDragStart={(e) => onDragStart(e, t)} onDragEnd={() => { setDragId(null); setOverCol(null) }}
        onClick={() => setViewing(t.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setViewing(t.id) }}
        title="Click to open · drag onto someone to reassign">
        <div className="tb-title">{t.title}</div>
        <div className="tb-meta">
          <span className="tb-no">{taskCode(t.task_no)}</span>
          <PriorityBadge priority={t.priority} />
          {t.task_type === 'recurring' && <span className="tb-chip"><Repeat size={11} /> Daily</span>}
          {t.kind === 'reel' && <span className="tb-chip reel">🎬 Reel</span>}
          {timing.has(t.id) && <span className="tb-live" title="Edit timer running"><span className="live-dot" /> Editing</span>}
        </div>
        <div className="tb-meta">
          {t.due_date && <span className={`tb-due ${late ? 'late' : ''}`}><AlarmClock size={13} /> {shortDate(t.due_date)}</span>}
          {t.start_time && t.end_time && <span className="tb-time">{formatTimeRange(t.start_time, t.end_time)}{len && ` · ${len}`}</span>}
          {t.status === 'in_progress' && started[t.id] && <span className="tb-started" title="Started (moved to In Progress)"><Play size={11} fill="currentColor" /> {clock(started[t.id])}</span>}
          {t.status === 'done' && t.completed_at && <span className="tb-done" title="Completed"><CheckCircle2 size={13} /> {clock(t.completed_at)}</span>}
        </div>
      </div>
    )
  }

  const column = (id: string, name: string, list: Task[], done?: number, sub?: string) => (
    <div key={id} className={`tb-col ${overCol === id ? 'drop' : ''} ${id === UNASSIGNED ? 'unassigned' : ''}`}
      onDragOver={(e) => onDragOver(e, id)} onDragLeave={() => setOverCol((c) => (c === id ? null : c))} onDrop={(e) => onDrop(e, id)}>
      <div className="tb-head">
        <span className="tb-avatar">{id === UNASSIGNED ? <UserX size={15} /> : initials(name).slice(0, 1)}</span>
        {id === UNASSIGNED
          ? <div className="tb-name"><b>{name}</b>{sub && <small>{sub}</small>}</div>
          : <button type="button" className="tb-name tb-name-btn" onClick={() => openPerson(id)} title={`Open ${name}'s board`}>
              <b>{name} <ChevronRight size={14} /></b>{sub && <small>{sub}</small>}
            </button>}
        <span className="tb-count" title="Tasks shown">{list.length}</span>
        {!!done && <span className="tb-donecount" title="Completed today">✓{done}</span>}
      </div>
      <div className="tb-list">
        {list.map(card)}
        {list.length === 0 && <div className="tb-empty">{dragId && id !== UNASSIGNED ? 'Drop here to assign' : 'No tasks'}</div>}
      </div>
    </div>
  )

  const teamName = (id: string | null) => teams.find((t) => t.id === id)?.name
  const person = personId ? users.find((u) => u.id === personId) : undefined

  // ---- one person's board: To Do / In Progress / Done ----
  const weekAgo = addDays(today, -6)
  const personBoard = () => {
    const mine = tasks.filter((t) => t.assigned_to === personId).filter((t) => {
      const d = t.due_date
      if (due === 'today' && d !== today) return false
      if (due === 'overdue' && !isOverdue(t)) return false
      if (due === 'today_overdue' && !(d === today || isOverdue(t))) return false
      if (due === 'week' && !(d && d >= today && d <= weekEnd)) return false
      if (q && !t.title.toLowerCase().includes(q) && !taskCode(t.task_no).toLowerCase().includes(q)) return false
      // Done: only what was finished in the last 7 days, so the column stays useful.
      if (t.status === 'done' && !(t.completed_at && todayStr(new Date(t.completed_at)) >= weekAgo)) return false
      return true
    })
    const col = (st: TaskStatus) => {
      const list = mine.filter((t) => t.status === st)
        .sort((a, b) => st === 'done'
          ? (b.completed_at ?? '').localeCompare(a.completed_at ?? '')
          : (a.due_date ?? '9').localeCompare(b.due_date ?? '9') || b.task_no - a.task_no)
      const id = ST + st
      return (
        <div key={st} className={`tb-col tb-stcol st-${st} ${overCol === id ? 'drop' : ''}`}
          onDragOver={(e) => onDragOver(e, id)} onDragLeave={() => setOverCol((c) => (c === id ? null : c))} onDrop={(e) => onDrop(e, id)}>
          <div className="tb-head">
            <span className={`tb-dot st-${st}`} />
            <div className="tb-name"><b>{STATUS_LABELS[st]}</b>{st === 'done' && <small>Last 7 days</small>}</div>
            <span className="tb-count">{list.length}</span>
          </div>
          <div className="tb-list">
            {list.map(card)}
            {list.length === 0 && <div className="tb-empty">{dragId ? `Drop here: ${STATUS_LABELS[st]}` : 'No tasks'}</div>}
          </div>
        </div>
      )
    }
    return <div className="tb-grid tb-statuses">{STATUS_COLS.map(col)}</div>
  }
  const personHead = () => (
    <div className="tb-person-head">
      <button className="secondary" onClick={() => openPerson(null)}><ArrowLeft size={16} /> All people</button>
      <span className="tb-avatar lg">{person ? initials(person.full_name).slice(0, 1) : '?'}</span>
      <div className="tb-name">
        <b>{person?.full_name ?? 'Unknown person'}</b>
        <small>{[teamName(person?.team_id ?? null), `✓ ${doneToday.get(personId!) ?? 0} done today`].filter(Boolean).join(' · ')}</small>
      </div>
      <select className="pill-select" value={personId ?? ''} onChange={(e) => openPerson(e.target.value)} aria-label="Person">
        {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
      </select>
    </div>
  )
  const shownTotal = people.reduce((n, u) => n + (byPerson.get(u.id)?.length ?? 0), 0) + unassigned.length

  return (
    <>
      <div className="page-head">
        <div>
          <h2>{person ? `${person.full_name}'s Board` : 'Team Board'}</h2>
          <p>{person
            ? 'Their tasks by status. Drag a card to another column to change its status; click it to open. ▶ = when work started.'
            : "Everyone's tasks at a glance. Click a name to see their board by status; drag a card onto another person to reassign it. ▶ = when work started, ✓ = done today."}</p>
        </div>
        <div className="head-actions">
          <button className="secondary" onClick={load}><RefreshCw size={16} /> Refresh</button>
        </div>
      </div>

      {error && <div className="alert error" onClick={() => setError('')}>{error}</div>}
      {personId && personHead()}

      <div className="tb-filters">
        {!personId && (
          <div className="view-tabs">
            {STATUS_OPTIONS.map(([v, l]) => <button key={v} className={status === v ? 'active' : ''} onClick={() => setStatus(v)}>{l}</button>)}
          </div>
        )}
        <select className="pill-select" value={due} onChange={(e) => setDue(e.target.value as DueFilter)} aria-label="Due date">
          {DUE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {!personId && (
          <select className="pill-select" value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team">
            <option value="">All teams</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <div className="search-box">
          <Search size={16} />
          <input placeholder="Search title or TM-number" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {!personId && <span className="count-pill">{shownTotal} Tasks</span>}
      </div>

      {loading ? <div className="empty">Loading…</div> : personId ? personBoard() : (
        <div className="tb-grid">
          {unassigned.length > 0 && !team && column(UNASSIGNED, 'Unassigned', unassigned)}
          {people.map((u) => column(u.id, u.full_name, byPerson.get(u.id) ?? [], doneToday.get(u.id), teamName(u.team_id)))}
        </div>
      )}

      {toast && (
        <div className="tb-toast" role="status">
          {toast.text}
          {toast.undo && <button className="link-btn" onClick={toast.undo}>Undo</button>}
        </div>
      )}
      {viewing && !editing && <TaskView taskId={viewing} onClose={() => setViewing(null)} onEdit={setEditing} onChanged={load} />}
      {editing && <TaskForm task={editing} users={users} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    </>
  )
}

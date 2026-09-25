import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { DatesSetArg, DateSelectArg, EventClickArg, EventContentArg, EventDropArg, EventInput } from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import { AlertTriangle, CheckCircle2, CircleDot, Clock3, Hourglass, ListTodo, Plus, Repeat, UserRound } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { StatCard } from '../components/StatCard'
import { RecurringInfo } from '../components/RecurringInfo'
import { RecurringScopeDialog } from '../components/RecurringScopeDialog'
import { applyTimeEveryDay, applyTimeOneFutureDay } from '../lib/recurringScope'
import { TaskForm } from '../components/TaskForm'
import { TaskView } from '../components/TaskView'
import { supabase } from '../lib/supabase'
import { addDays, canSetTime, dueTag, fetchTasks, RECURRING_SELECT, taskCode, todayStr, type RecurringTask, type Task } from '../lib/tasks'
import { useActiveUsers } from '../lib/useActiveUsers'
import { useMinuteTick } from '../lib/useMinuteTick'

const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`


const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** A few years either side of today, always including the year being shown. */
function yearOptions(shown: number) {
  const now = new Date().getFullYear()
  const from = Math.min(now - 2, shown), to = Math.max(now + 3, shown)
  return Array.from({ length: to - from + 1 }, (_, i) => from + i)
}

/** Google-style Day / Week / Month calendar of a person's tasks, placed at their time (or in the "Due" row). */
export function Calendar() {
  const { profile } = useAuth()
  const tick = useMinuteTick()   // keeps Ongoing/Expired colours current
  const users = useActiveUsers()
  const isAdmin = profile?.role === 'admin'
  // Admins start on "All users" (everyone's tasks together); others see only their own.
  const [userId, setUserId] = useState(profile?.role === 'admin' ? 'all' : profile?.id ?? '')
  const isMine = userId === profile?.id
  const showAll = userId === 'all'
  const [tasks, setTasks] = useState<Task[]>([])
  const [templates, setTemplates] = useState<RecurringTask[]>([])
  const [range, setRange] = useState<{ start: string; end: string } | null>(null)
  const [viewType, setViewType] = useState('')
  const [period, setPeriod] = useState<{ start: string; end: string } | null>(null)   // the day/week/month itself (not the padded grid)
  const [cursor, setCursor] = useState(() => new Date())          // month shown in Month view
  const [planned, setPlanned] = useState<{ item: RecurringTask; date: string } | null>(null)
  // A drag/resize of a recurring task waiting for "only this date / every day".
  const [scope, setScope] = useState<{
    canAll: boolean; revert: () => void; only: () => Promise<void>; all: () => Promise<void>
  } | null>(null)
  const [scopeBusy, setScopeBusy] = useState(false)
  const [creating, setCreating] = useState<{ dueDate: string; from: string; to: string; assignTo?: string } | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [error, setError] = useState('')
  const calRef = useRef<FullCalendar>(null)
  const narrow = typeof window !== 'undefined' && window.innerWidth < 800

  useEffect(() => { if (profile && !userId) setUserId(profile.role === 'admin' ? 'all' : profile.id) }, [profile, userId])

  const load = useCallback(() => {
    fetchTasks().then(setTasks).catch((e) => setError(String(e)))
    supabase.from('recurring_tasks').select(RECURRING_SELECT).eq('is_active', true)
      .then(({ data }) => setTemplates((data as RecurringTask[]) ?? []))
  }, [])
  useEffect(() => { load() }, [load])

  const personTasks = useMemo(() => tasks.filter((t) => t.due_date && (showAll || t.assigned_to === userId)), [tasks, userId, showAll])

  // Future days of recurring tasks: shown as "scheduled" until the real copy is created that day.
  const plannedEvents: EventInput[] = useMemo(() => {
    if (!range) return []
    const today = todayStr()
    const have = new Set(tasks.filter((t) => t.recurring_id).map((t) => `${t.recurring_id}|${t.occurrence_date}`))
    const out: EventInput[] = []
    for (const r of templates) {
      if (!showAll && r.assigned_to !== userId) continue
      // From tomorrow onwards: today (and earlier) always shows the real task, never a projection.
      let d = [range.start, r.start_date, addDays(today, 1)].sort()[2]
      const last = [addDays(range.end, -1), r.end_date ?? '9999-12-31'].sort()[0]
      for (; d <= last; d = addDays(d, 1)) {
        const dow = new Date(d + 'T00:00:00').getDay()
        if (!r.weekdays.includes(dow) || have.has(`${r.id}|${d}`)) continue
        const timed = !!(r.start_time && r.end_time)
        out.push({
          id: `plan:${r.id}:${d}`,
          title: `↻ ${r.title}`,
          start: timed ? `${d}T${r.start_time}` : d,
          end: timed ? `${d}T${r.end_time}` : undefined,
          allDay: !timed,
          editable: isAdmin || r.assigned_to === profile?.id || r.created_by === profile?.id,
          classNames: ['tk-planned', timed ? 'tk-timed' : 'due'],
          extendedProps: { planned: true, recurring: r, date: d, who: r.assignee?.full_name ?? '' },
        })
      }
    }
    return out
  }, [templates, tasks, range, showAll, userId, isAdmin, profile?.id])

  const events: EventInput[] = useMemo(() => [...plannedEvents, ...personTasks.map((t) => {
    const timed = !!(t.start_time && t.end_time)
    return {
      id: t.id,
      title: `${taskCode(t.task_no)} · ${t.title}`,
      start: timed ? `${t.due_date}T${t.start_time}` : t.due_date!,
      end: timed ? `${t.due_date}T${t.end_time}` : undefined,
      allDay: !timed,
      editable: canSetTime(t, profile?.id, isAdmin),
      classNames: [timed ? 'tk-timed' : 'due', `due-${dueTag(t)}`, t.status === 'done' ? 'tk-done' : ''],
      extendedProps: { task: t, who: t.assignee?.full_name ?? '' },
    }
  })], [plannedEvents, personTasks, profile?.id, isAdmin, tick])

  // Header counts for the day / week / month on screen (for the person picked).
  const counts = useMemo(() => {
    const inP = (d: string) => !!period && d >= period.start && d < period.end
    const list = personTasks.filter((t) => inP(t.due_date!))
    return {
      total: list.length,
      todo: list.filter((t) => t.status === 'todo').length,
      inProgress: list.filter((t) => t.status === 'in_progress').length,
      done: list.filter((t) => t.status === 'done').length,
      expired: list.filter((t) => dueTag(t) === 'expired').length,
      untimed: list.filter((t) => !(t.start_time && t.end_time)).length,
      upcoming: plannedEvents.filter((e) => inP(String(e.extendedProps?.date))).length,
    }
  }, [personTasks, plannedEvents, period, tick])
  const periodWord = viewType === 'timeGridDay' ? 'Today' : viewType === 'dayGridMonth' ? 'This Month' : 'This Week'
  const isCurrentPeriod = !!period && todayStr() >= period.start && todayStr() < period.end
  const periodLabel = isCurrentPeriod ? periodWord
    : viewType === 'timeGridDay' ? 'Selected Day' : viewType === 'dayGridMonth' ? 'Selected Month' : 'Selected Week'

  const onSelect = (arg: DateSelectArg) => {
    calRef.current?.getApi().unselect()
    // Click or drag on empty space → Add Task, pre-filled with that day (and time range, in Day/Week view).
    // On someone else's calendar the new task is assigned to that person.
    const date = todayStr(arg.start)
    const assignTo = !showAll && userId ? userId : undefined
    if (arg.allDay) setCreating({ dueDate: date, from: '', to: '', assignTo })
    else setCreating({ dueDate: date, from: hhmm(arg.start), to: hhmm(arg.end), assignTo })
  }

  const onEventClick = (arg: EventClickArg) => {
    const p = arg.event.extendedProps
    if (p.planned) setPlanned({ item: p.recurring as RecurringTask, date: p.date as string })
    else setViewing((p.task as Task).id)
  }

  const onMove = async (arg: EventDropArg | EventResizeDoneArg) => {
    const p = arg.event.extendedProps
    const start = arg.event.start
    if (!start) return arg.revert()
    const newDate = todayStr(start)
    let startT: string | null = null
    let endT: string | null = null
    if (!arg.event.allDay) {
      const end = arg.event.end ?? new Date(start.getTime() + 60 * 60000)
      if (todayStr(end) !== newDate && hhmm(end) !== '00:00') {
        setError('A task has to start and end on the same day.')
        return arg.revert()
      }
      startT = `${hhmm(start)}:00`
      endT = hhmm(end) === '00:00' ? '23:59:00' : `${hhmm(end)}:00`
    }

    // Future day of a recurring task (dashed card)
    if (p.planned) {
      const r = p.recurring as RecurringTask
      const date = p.date as string
      const timeChanged = startT !== r.start_time || endT !== r.end_time
      const only = () => applyTimeOneFutureDay(r.id, date, startT, endT, newDate !== date ? newDate : undefined)
      if (!timeChanged) return run(only, arg.revert)
      return setScope({
        canAll: isAdmin || r.created_by === profile?.id, revert: arg.revert, only,
        all: async () => {
          await applyTimeEveryDay(r.id, todayStr(), startT, endT)
          if (newDate !== date) await applyTimeOneFutureDay(r.id, date, startT, endT, newDate)
        },
      })
    }

    const t = p.task as Task
    const patch: Record<string, unknown> = { start_time: startT, end_time: endT }
    if (newDate !== t.due_date) patch.due_date = newDate
    const only = async () => {
      const { error } = await supabase.from('tasks').update(patch).eq('id', t.id)
      if (error) throw new Error(error.message)
    }
    const timeChanged = startT !== t.start_time || endT !== t.end_time
    if (!t.recurring_id || !timeChanged) return run(only, arg.revert)
    setScope({
      canAll: isAdmin || t.created_by === profile?.id, revert: arg.revert, only,
      all: async () => { await only(); await applyTimeEveryDay(t.recurring_id!, t.occurrence_date ?? newDate, startT, endT) },
    })
  }

  const run = async (fn: () => Promise<void>, revert: () => void) => {
    try { await fn(); load() } catch (e) { setError(e instanceof Error ? e.message : String(e)); revert() }
  }

  const chooseScope = async (which: 'only' | 'all') => {
    if (!scope) return
    setScopeBusy(true)
    await run(which === 'only' ? scope.only : scope.all, scope.revert)
    setScopeBusy(false)
    setScope(null)
  }


  const renderEvent = (arg: EventContentArg) => {
    const who = arg.event.extendedProps.who as string
    if (arg.event.allDay) {
      return <div className="ev-due" title={`${arg.event.title} · ${who}`}>{arg.event.title}<span className="ev-who-inline"> · {who}</span></div>
    }
    return (
      <div className="ev-block" title={`${arg.event.title} · ${who}`}>
        <div className="ev-time">{arg.timeText}</div>
        <div className="ev-title">{arg.event.title}</div>
        <div className="ev-who"><UserRound size={11} /> {who}</div>
      </div>
    )
  }

  const personName = users.find((u) => u.id === userId)?.full_name

  return (
    <>
      <div className="page-head">
        <div>
          <h2>{showAll ? 'All Users’ Calendar' : isMine ? 'My Calendar' : `${personName ?? ''}'s Calendar`}</h2>
          <p>{showAll
            ? 'Everyone’s tasks at their time. Each card shows who it is assigned to. Pick a person to see only their tasks. Click or drag on an empty slot to add a task.'
            : isMine
              ? 'Your tasks at their time. Drag a task to change its time, or drag it from the Due row into a time slot. Click or drag on an empty slot to add a task.'
              : 'Tasks assigned to this person, at their planned time. Click or drag on an empty slot to add a task for them.'}</p>
        </div>
        <div className="head-actions">
          {isAdmin && (
            <select className="pill-select" value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Whose calendar">
              <option value="all">All users</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.id === profile?.id ? `${u.full_name} (me)` : u.full_name}</option>)}
            </select>
          )}
          <button onClick={() => setCreating({ dueDate: todayStr(), from: '', to: '' })}><Plus size={18} /> Add Task</button>
        </div>
      </div>

      {error && <div className="alert error" onClick={() => setError('')}>{error}</div>}

      <div className="section-label">{periodLabel}</div>
      <div className="stats cal-stats">
        <StatCard icon={ListTodo} tone="navy" value={counts.total} label="Total Tasks" />
        <StatCard icon={CircleDot} tone="blue" value={counts.todo} label="To Do" />
        <StatCard icon={Hourglass} tone="yellow" value={counts.inProgress} label="In Progress" />
        <StatCard icon={CheckCircle2} tone="green" value={counts.done} label="Completed" />
        <StatCard icon={AlertTriangle} tone="red" value={counts.expired} label="Expired" />
        <StatCard icon={Repeat} tone="purple" value={counts.upcoming} label="Upcoming Recurring" />
        <StatCard icon={Clock3} tone="orange" value={counts.untimed} label="Without Time" />
      </div>

      <div className="cal-legend">
        <span><i className="lg-ongoing" /> Ongoing</span>
        <span><i className="lg-expired" /> Expired</span>
        <span><i className="lg-completed" /> Completed</span>
        <span><i className="lg-planned" /> Scheduled (recurring)</span>
        <span className="muted">· Tasks without a time sit in the “Due” row</span>
      </div>

      <div className="panel cal-panel">
        {viewType === 'dayGridMonth' && (
          <div className="cal-jump">
            <select aria-label="Month" value={cursor.getMonth()}
              onChange={(e) => calRef.current?.getApi().gotoDate(new Date(cursor.getFullYear(), Number(e.target.value), 1))}>
              {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
            </select>
            <select aria-label="Year" value={cursor.getFullYear()}
              onChange={(e) => calRef.current?.getApi().gotoDate(new Date(Number(e.target.value), cursor.getMonth(), 1))}>
              {yearOptions(cursor.getFullYear()).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        )}
        <FullCalendar
          ref={calRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView={narrow ? 'timeGridDay' : 'timeGridWeek'}
          headerToolbar={narrow
            ? { left: 'prev,next', center: viewType === 'dayGridMonth' ? '' : 'title', right: 'today' }
            : { left: 'today prev,next', center: viewType === 'dayGridMonth' ? '' : 'title', right: 'timeGridDay,timeGridWeek,dayGridMonth' }}
          footerToolbar={narrow ? { center: 'timeGridDay,timeGridWeek,dayGridMonth' } : undefined}
          buttonText={{ today: 'Today', day: 'Day', week: 'Week', month: 'Month' }}
          firstDay={0}
          height="auto"
          expandRows
          nowIndicator
          allDayText="Due"
          slotMinTime="06:00:00"
          slotMaxTime="24:00:00"
          slotDuration="00:30:00"
          snapDuration="00:05:00"
          defaultTimedEventDuration="01:00"
          slotLabelFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
          eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
          selectable
          // A task lives on one day, so a selection can't spread across days.
          selectAllow={(sel) => todayStr(sel.start) === todayStr(new Date(sel.end.getTime() - 1))}
          selectMirror
          editable
          dayMaxEvents={showAll ? 4 : 3}
          slotEventOverlap={false}
          events={events}
          select={onSelect}
          eventClick={onEventClick}
          eventDrop={onMove}
          eventResize={onMove}
          eventContent={renderEvent}
          datesSet={(arg: DatesSetArg) => {
            setRange({ start: todayStr(arg.start), end: todayStr(arg.end) })
            setViewType(arg.view.type)
            setPeriod({ start: todayStr(arg.view.currentStart), end: todayStr(arg.view.currentEnd) })
            setCursor(arg.view.currentStart)
          }}
        />
      </div>

      {scope && (
        <RecurringScopeDialog canAll={scope.canAll} busy={scopeBusy}
          onOnly={() => chooseScope('only')} onAll={() => chooseScope('all')}
          onCancel={() => { scope.revert(); setScope(null) }} />
      )}
      {planned && (
        <RecurringInfo item={planned.item} date={planned.date} users={users}
          onClose={() => setPlanned(null)} onSaved={() => { setPlanned(null); load() }} />
      )}
      {creating && (
        <TaskForm users={users} initial={creating} onClose={() => setCreating(null)}
          onSaved={() => { setCreating(null); load() }} />
      )}
      {viewing && !editingTask && (
        <TaskView taskId={viewing} onClose={() => setViewing(null)} onEdit={setEditingTask} onChanged={load} />
      )}
      {editingTask && (
        <TaskForm task={editingTask} users={users} onClose={() => setEditingTask(null)}
          onSaved={() => { setEditingTask(null); load() }} />
      )}
    </>
  )
}

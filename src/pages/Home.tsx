import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, BellDot, CalendarCheck, CheckCircle2, CircleDot, ClipboardList, Gauge, Hourglass, Send, ShieldCheck, Target, UserCheck, Users, UsersRound,
} from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { StatCard } from '../components/StatCard'
import { TaskTable } from '../components/TaskTable'
import { TaskView } from '../components/TaskView'
import { TaskForm } from '../components/TaskForm'
import { supabase } from '../lib/supabase'
import { addDays, fetchTasks, isGivenBy, isNewFor, isOverdue, todayStr, type Task, type TaskStatus } from '../lib/tasks'
import { useActiveUsers } from '../lib/useActiveUsers'
import { useMinuteTick } from '../lib/useMinuteTick'

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—')

export function Home() {
  const { profile } = useAuth()
  const tick = useMinuteTick()   // keeps Expired counts current
  const users = useActiveUsers()
  const [tasks, setTasks] = useState<Task[]>([])
  const [people, setPeople] = useState({ total: 0, active: 0, teams: 0, managers: 0 })
  const [viewing, setViewing] = useState<string | null>(null)
  const [editing, setEditing] = useState<Task | null>(null)

  const load = useCallback(() => { fetchTasks().then(setTasks).catch(() => setTasks([])) }, [])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (profile?.role !== 'admin') return
    Promise.all([
      supabase.from('profiles').select('is_active, role_info:roles(name)'),
      supabase.from('teams').select('id'),
    ]).then(([p, t]) => {
      const rows = (p.data ?? []) as unknown as { is_active: boolean; role_info: { name: string } | null }[]
      setPeople({
        total: rows.length,
        active: rows.filter((r) => r.is_active).length,
        managers: rows.filter((r) => r.is_active && r.role_info?.name === 'Manager').length,
        teams: t.data?.length ?? 0,
      })
    })
  }, [profile?.role])

  const today = todayStr()
  const weekAgo = addDays(today, -6)
  const stats = useMemo(() => {
    const mine = tasks.filter((t) => t.assigned_to === profile?.id)
    const given = tasks.filter((t) => isGivenBy(t, profile?.id))
    const open = (l: Task[]) => l.filter((t) => t.status !== 'done')
    const doneWithDue = tasks.filter((t) => t.status === 'done' && t.due_date && t.completed_at)
    return {
      newTasks: mine.filter((t) => isNewFor(t, profile?.id)).length,
      dueToday: open(mine).filter((t) => t.due_date === today).length,
      todo: mine.filter((t) => t.status === 'todo').length,
      inProgress: mine.filter((t) => t.status === 'in_progress').length,
      overdue: mine.filter(isOverdue).length,
      doneToday: mine.filter((t) => t.completed_at && todayStr(new Date(t.completed_at)) === today).length,
      givenOpen: open(given).length,
      givenOverdue: given.filter(isOverdue).length,
      // company-wide (admins see every task)
      allOpen: open(tasks).length,
      allOverdue: tasks.filter(isOverdue).length,
      doneWeek: tasks.filter((t) => t.completed_at && todayStr(new Date(t.completed_at)) >= weekAgo).length,
      onTime: pct(doneWithDue.filter((t) => todayStr(new Date(t.completed_at!)) <= t.due_date!).length, doneWithDue.length),
      completion: pct(tasks.filter((t) => t.status === 'done').length, tasks.length),
      todayList: open(mine).filter((t) => isNewFor(t, profile?.id) || (t.due_date && t.due_date <= today))
        .sort((a, b) => Number(isNewFor(b, profile?.id)) - Number(isNewFor(a, profile?.id))
          || (a.due_date ?? '9999') .localeCompare(b.due_date ?? '9999')),
    }
  }, [tasks, profile?.id, today, weekAgo, tick])

  if (!profile) return null
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const changeStatus = async (t: Task, s: TaskStatus) => {
    setTasks((all) => all.map((x) => (x.id === t.id ? { ...x, status: s } : x)))
    await supabase.from('tasks').update({ status: s }).eq('id', t.id)
    load()
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Highlights</h2>
          <p>{greeting}, {profile.full_name.split(' ')[0]} · {profile.role_info?.name ?? (profile.role === 'admin' ? 'Admin' : 'Team Member')}</p>
        </div>
      </div>

      <div className="section-label">My Day</div>
      <div className="stats">
        <StatCard icon={BellDot} tone="orange" value={stats.newTasks} label="New / Reassigned" />
        <StatCard icon={CalendarCheck} tone="navy" value={stats.dueToday} label="Due Today" />
        <StatCard icon={CircleDot} tone="blue" value={stats.todo} label="To Do" />
        <StatCard icon={Hourglass} tone="yellow" value={stats.inProgress} label="In Progress" />
        <StatCard icon={AlertTriangle} tone="red" value={stats.overdue} label="Expired" />
        <StatCard icon={CheckCircle2} tone="green" value={stats.doneToday} label="Completed Today" />
      </div>

      <div className="section-label">Assigned by Me</div>
      <div className="stats">
        <StatCard icon={Send} tone="teal" value={stats.givenOpen} label="Open (given to others)" />
        <StatCard icon={AlertTriangle} tone="orange" value={stats.givenOverdue} label="Expired (given to others)" />
      </div>

      {profile.role === 'admin' && (
        <>
          <div className="section-label">Company Overview</div>
          <div className="stats">
            <StatCard icon={ClipboardList} tone="navy" value={stats.allOpen} label="Open Tasks" />
            <StatCard icon={AlertTriangle} tone="red" value={stats.allOverdue} label="Expired Tasks" />
            <StatCard icon={CheckCircle2} tone="green" value={stats.doneWeek} label="Completed (7 days)" />
            <StatCard icon={Target} tone="blue" value={stats.onTime} label="On-time Rate" />
            <StatCard icon={Gauge} tone="purple" value={stats.completion} label="Completion Rate" />
            <StatCard icon={Users} tone="yellow" value={people.active} label="Active Users" />
            <StatCard icon={ShieldCheck} tone="orange" value={people.managers} label="Managers" />
            <StatCard icon={UsersRound} tone="teal" value={people.teams} label="Teams" />
          </div>
        </>
      )}

      <div className="section-label">New, Today &amp; Expired</div>
      <div className="panel today-list">
        <div className="panel-toolbar">
          <span className="tab-chip"><UserCheck size={18} /> My Tasks</span>
          <span className="count-pill">{stats.todayList.length} Tasks</span>
          <span className="spacer" />
          <Link to="/tasks" className="btn">View all tasks</Link>
        </div>
        <div className="table-scroll">
          {stats.todayList.length === 0 ? (
            <div className="empty"><CheckCircle2 size={40} /><b>All clear</b>Nothing new, due today or expired.</div>
          ) : (
            <TaskTable tasks={stats.todayList} person="assigner" onOpen={(t) => setViewing(t.id)} onStatus={changeStatus} />
          )}
        </div>
      </div>

      {viewing && !editing && <TaskView taskId={viewing} onClose={() => setViewing(null)} onEdit={setEditing} onChanged={load} />}
      {editing && <TaskForm task={editing} users={users} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    </>
  )
}

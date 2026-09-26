import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardList, Clock3, Download, Gauge, Hourglass, Target, Timer } from 'lucide-react'
import { StatCard } from '../components/StatCard'
import { supabase } from '../lib/supabase'
import {
  addDays, formatDate, formatTimeRange, PRIORITY_LABELS, STATUS_LABELS, TASK_SELECT, taskCode, todayStr, TYPE_LABELS, type Task,
} from '../lib/tasks'
import type { Team } from '../lib/types'

/** One person's numbers for the chosen range (from the report_by_person RPC). */
export interface PersonRow {
  user_id: string; full_name: string; team_name: string | null; role_name: string | null
  assigned: number; completed: number; on_time: number; late: number; expired: number; pending: number
}

type Preset = 'today' | 'week' | 'month' | 'last_month' | 'custom'

function rangeFor(p: Preset): [string, string] {
  const today = todayStr()
  const d = new Date(today + 'T00:00:00')
  if (p === 'today') return [today, today]
  if (p === 'week') { const start = addDays(today, -d.getDay()); return [start, addDays(start, 6)] }   // Sun–Sat, like the calendar
  if (p === 'month') return [todayStr(new Date(d.getFullYear(), d.getMonth(), 1)), todayStr(new Date(d.getFullYear(), d.getMonth() + 1, 0))]
  return [todayStr(new Date(d.getFullYear(), d.getMonth() - 1, 1)), todayStr(new Date(d.getFullYear(), d.getMonth(), 0))]
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null)
const pctText = (v: number | null) => (v === null ? '—' : `${v}%`)

/** Deadline = end time on the due date, or the end of that day (same rule as the Expired tag). */
function resultOf(t: Task): 'On time' | 'Late' | 'Expired' | 'Pending' {
  const deadline = new Date(`${t.due_date}T${t.end_time ? t.end_time.slice(0, 8) : '23:59:59'}`)
  if (t.status === 'done') return t.completed_at && new Date(t.completed_at) <= deadline ? 'On time' : 'Late'
  return deadline < new Date() ? 'Expired' : 'Pending'
}

export function Reports() {
  const [preset, setPreset] = useState<Preset>('month')
  const [[from, to], setRange] = useState<[string, string]>(() => rangeFor('month'))
  const [teams, setTeams] = useState<Team[]>([])
  const [teamId, setTeamId] = useState('')
  const [rows, setRows] = useState<PersonRow[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('teams').select('id, name').order('name').then(({ data }) => setTeams((data as Team[]) ?? []))
  }, [])

  const load = useCallback(async () => {
    if (!from || !to || from > to) return
    setLoading(true)
    const { data, error } = await supabase.rpc('report_by_person', { p_from: from, p_to: to, p_team: teamId || null })
    if (error) setError(error.message)
    setRows((data as PersonRow[]) ?? [])
    setLoading(false)
  }, [from, to, teamId])
  useEffect(() => { load() }, [load])

  const pick = (p: Preset) => { setPreset(p); if (p !== 'custom') setRange(rangeFor(p)) }

  const total = useMemo(() => rows.reduce((a, r) => ({
    assigned: a.assigned + r.assigned, completed: a.completed + r.completed, on_time: a.on_time + r.on_time,
    late: a.late + r.late, expired: a.expired + r.expired, pending: a.pending + r.pending,
  }), { assigned: 0, completed: 0, on_time: 0, late: 0, expired: 0, pending: 0 }), [rows])

  const exportExcel = async () => {
    setExporting(true); setError('')
    try {
      // Task list for the same range and team.
      let q = supabase.from('tasks').select(TASK_SELECT).gte('due_date', from).lte('due_date', to)
        .order('due_date').order('task_no').limit(5000)
      if (teamId) q = q.in('assigned_to', rows.map((r) => r.user_id))
      const { data, error } = await q
      if (error) throw new Error(error.message)
      const tasks = (data ?? []) as Task[]
      const { default: writeXlsxFile } = await import('write-excel-file')

      const head = (labels: string[]) => labels.map((value) => ({ value, fontWeight: 'bold' as const, backgroundColor: '#E8EAF6' }))
      const summary = [
        head(['Person', 'Team', 'Role', 'Assigned', 'Completed', 'On time', 'Late', 'Expired', 'Pending', 'Completion %', 'On-time %']),
        ...rows.map((r) => [
          { value: r.full_name }, { value: r.team_name ?? '' }, { value: r.role_name ?? '' },
          { value: r.assigned }, { value: r.completed }, { value: r.on_time }, { value: r.late }, { value: r.expired }, { value: r.pending },
          { value: pct(r.completed, r.assigned) ?? undefined }, { value: pct(r.on_time, r.completed) ?? undefined },
        ]),
        [
          { value: 'Total', fontWeight: 'bold' as const }, { value: '' }, { value: '' },
          { value: total.assigned }, { value: total.completed }, { value: total.on_time }, { value: total.late },
          { value: total.expired }, { value: total.pending },
          { value: pct(total.completed, total.assigned) ?? undefined }, { value: pct(total.on_time, total.completed) ?? undefined },
        ],
      ]
      const detail = [
        head(['Task No.', 'Title', 'Assigned To', 'Assigned By', 'Type', 'Priority', 'Due Date', 'Time', 'Status', 'Result', 'Completed At']),
        ...tasks.map((t) => [
          { value: taskCode(t.task_no) }, { value: t.title }, { value: t.assignee?.full_name ?? '' }, { value: t.assigner?.full_name ?? '' },
          { value: TYPE_LABELS[t.task_type] }, { value: PRIORITY_LABELS[t.priority] }, { value: formatDate(t.due_date) },
          { value: t.start_time ? formatTimeRange(t.start_time, t.end_time) : '' }, { value: STATUS_LABELS[t.status] },
          { value: resultOf(t) }, { value: t.completed_at ? new Date(t.completed_at).toLocaleString('en-IN') : '' },
        ]),
      ]
      await writeXlsxFile([summary, detail], {
        sheets: ['Summary', 'Tasks'],
        columns: [
          [{ width: 24 }, { width: 14 }, { width: 14 }, ...Array(8).fill({ width: 12 })],
          [{ width: 10 }, { width: 40 }, { width: 20 }, { width: 20 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 18 }, { width: 12 }, { width: 10 }, { width: 20 }],
        ],
        fileName: `Task-Report_${from}_to_${to}.xlsx`,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Reports</h2>
          <p>Completion and on-time numbers per person, for tasks due in the chosen dates. A task is on time when it's marked Done by its end time (or by the end of its due date).</p>
        </div>
        <div className="head-actions">
          <button onClick={exportExcel} disabled={exporting || loading || !rows.length}><Download size={17} /> {exporting ? 'Preparing…' : 'Export Excel'}</button>
        </div>
      </div>

      {error && <div className="alert error" onClick={() => setError('')}>{error}</div>}

      <div className="report-filters">
        <div className="view-tabs">
          {([['today', 'Today'], ['week', 'This Week'], ['month', 'This Month'], ['last_month', 'Last Month'], ['custom', 'Custom']] as [Preset, string][]).map(([k, l]) => (
            <button key={k} className={preset === k ? 'active' : ''} onClick={() => pick(k)}>{l}</button>
          ))}
        </div>
        <label>From <input type="date" value={from} onChange={(e) => { setPreset('custom'); setRange([e.target.value, to]) }} /></label>
        <label>To <input type="date" value={to} min={from} onChange={(e) => { setPreset('custom'); setRange([from, e.target.value]) }} /></label>
        <select className="pill-select" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">All Teams</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      <div className="stats tab-stats">
        <StatCard icon={ClipboardList} tone="navy" value={total.assigned} label="Assigned" />
        <StatCard icon={CheckCircle2} tone="green" value={total.completed} label="Completed" />
        <StatCard icon={Target} tone="teal" value={total.on_time} label="On Time" />
        <StatCard icon={Timer} tone="orange" value={total.late} label="Late" />
        <StatCard icon={AlertTriangle} tone="red" value={total.expired} label="Expired" />
        <StatCard icon={Hourglass} tone="yellow" value={total.pending} label="Pending" />
        <StatCard icon={Gauge} tone="purple" value={pctText(pct(total.completed, total.assigned))} label="Completion Rate" />
        <StatCard icon={Clock3} tone="blue" value={pctText(pct(total.on_time, total.completed))} label="On-time Rate" />
      </div>

      <div className="panel">
        <div className="table-scroll">
          {loading ? <div className="empty">Loading…</div> : rows.length === 0 ? (
            <div className="empty"><ClipboardList size={40} /><b>No people found</b>Try another team.</div>
          ) : (
            <table>
              <thead>
                <tr><th>Person</th><th>Team</th><th>Assigned</th><th>Completed</th><th>On Time</th><th>Late</th><th>Expired</th><th>Pending</th><th>Completion</th><th>On-time</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const c = pct(r.completed, r.assigned), o = pct(r.on_time, r.completed)
                  return (
                    <tr key={r.user_id}>
                      <td><b>{r.full_name}</b>{r.role_name && <div className="muted small">{r.role_name}</div>}</td>
                      <td>{r.team_name ?? '—'}</td>
                      <td>{r.assigned}</td><td>{r.completed}</td><td>{r.on_time}</td><td>{r.late}</td>
                      <td className={r.expired ? 'overdue-text' : ''}>{r.expired}</td><td>{r.pending}</td>
                      <td><Meter value={c} /></td><td><Meter value={o} /></td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td><b>Total</b></td><td />
                  <td>{total.assigned}</td><td>{total.completed}</td><td>{total.on_time}</td><td>{total.late}</td>
                  <td>{total.expired}</td><td>{total.pending}</td>
                  <td><Meter value={pct(total.completed, total.assigned)} /></td><td><Meter value={pct(total.on_time, total.completed)} /></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
      <p className="muted small-note">Completion = completed ÷ assigned. On-time = on time ÷ completed. Dates are {formatDate(from)} to {formatDate(to)}.</p>
    </>
  )
}

function Meter({ value }: { value: number | null }) {
  if (value === null) return <span className="muted">—</span>
  const tone = value >= 80 ? 'good' : value >= 50 ? 'mid' : 'low'
  return (
    <div className={`meter ${tone}`}>
      <span className="meter-bar"><i style={{ width: `${value}%` }} /></span>
      <b>{value}%</b>
    </div>
  )
}

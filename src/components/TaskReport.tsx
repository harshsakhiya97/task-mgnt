import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardList, Clock3, Download, Gauge, Hourglass, Target, Timer, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatDate, formatTimeRange, PRIORITY_LABELS, STATUS_LABELS, TASK_SELECT, taskCode, typeLabel, type Task } from '../lib/tasks'
import { StatCard } from './StatCard'
import { TypeChip } from './TaskBits'
import { initials } from '../lib/initials'

/** One person's numbers for the chosen range (from the report_by_person RPC). */
export interface PersonRow {
  user_id: string; full_name: string; team_name: string | null; role_name: string | null
  assigned: number; completed: number; on_time: number; late: number; expired: number; pending: number
}
type Result = 'On time' | 'Late' | 'Expired' | 'Pending'

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null)
const pctText = (v: number | null) => (v === null ? '—' : `${v}%`)

/** Deadline = end time on the due date, or the end of that day (same rule as the Expired tag and report_by_person). */
export function resultOf(t: Task): Result {
  const deadline = new Date(`${t.due_date}T${t.end_time ? t.end_time.slice(0, 8) : '23:59:59'}`)
  if (t.status === 'done') return t.completed_at && new Date(t.completed_at) <= deadline ? 'On time' : 'Late'
  return deadline < new Date() ? 'Expired' : 'Pending'
}

/** Tasks due in the range (meetings left out), for the export and the person pop-up. */
async function fetchTasks(from: string, to: string, people?: string[]) {
  let q = supabase.from('tasks').select(TASK_SELECT).gte('due_date', from).lte('due_date', to).neq('kind', 'meeting')
    .order('due_date').order('task_no').limit(5000)
  if (people) q = q.in('assigned_to', people)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as Task[]
}

/** Reports → Tasks (admin): completion and on-time numbers, a card per person, click → their tasks. */
export function TaskReport({ from, to, teamId, onOpen }: { from: string; to: string; teamId: string; onOpen?: (taskId: string) => void }) {
  const [rows, setRows] = useState<PersonRow[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [person, setPerson] = useState('')
  const [openPerson, setOpenPerson] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!from || !to || from > to) return
    setLoading(true)
    const { data, error } = await supabase.rpc('report_by_person', { p_from: from, p_to: to, p_team: teamId || null })
    if (error) setError(error.message)
    setRows((data as PersonRow[]) ?? [])
    setLoading(false)
  }, [from, to, teamId])
  useEffect(() => { load() }, [load])

  // People with tasks first, then the rest (alphabetical within each).
  const people = useMemo(() => [...rows].sort((a, b) => Number(!a.assigned) - Number(!b.assigned) || a.full_name.localeCompare(b.full_name)), [rows])
  const shown = person ? people.filter((p) => p.user_id === person) : people
  const total = useMemo(() => shown.reduce((a, r) => ({
    assigned: a.assigned + r.assigned, completed: a.completed + r.completed, on_time: a.on_time + r.on_time,
    late: a.late + r.late, expired: a.expired + r.expired, pending: a.pending + r.pending,
  }), { assigned: 0, completed: 0, on_time: 0, late: 0, expired: 0, pending: 0 }), [shown])
  const opened = people.find((p) => p.user_id === openPerson)

  const exportExcel = async () => {
    setExporting(true); setError('')
    try {
      const tasks = await fetchTasks(from, to, teamId || person ? shown.map((r) => r.user_id) : undefined)
      const { default: writeXlsxFile } = await import('write-excel-file')
      const head = (labels: string[]) => labels.map((value) => ({ value, fontWeight: 'bold' as const, backgroundColor: '#E8EAF6' }))
      const summary = [
        head(['Person', 'Team', 'Role', 'Assigned', 'Completed', 'On time', 'Late', 'Expired', 'Pending', 'Completion %', 'On-time %']),
        ...shown.map((r) => [
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
          { value: typeLabel(t) }, { value: PRIORITY_LABELS[t.priority] }, { value: formatDate(t.due_date) },
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
      {error && <div className="alert error" onClick={() => setError('')}>{error}</div>}
      <div className="rr-toolbar">
        <select className="pill-select" value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Person">
          <option value="">Everyone</option>
          {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}
        </select>
        <span className="spacer" />
        <button onClick={exportExcel} disabled={exporting || loading || !rows.length}><Download size={17} /> {exporting ? 'Preparing…' : 'Export Excel'}</button>
      </div>

      <div className="stats tab-stats rr-stats tr-stats">
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
        <div className="panel-toolbar"><span className="tab-chip">Team results</span><span className="spacer" /><span className="muted small">Click a person to see their tasks.</span></div>
        {loading ? <div className="empty">Loading…</div> : shown.length === 0 ? (
          <div className="empty"><ClipboardList size={40} /><b>No people found</b>Try another team.</div>
        ) : (
          <div className="rr-grid">
            {shown.map((r) => (
              <button key={r.user_id} type="button" className={`rr-card${r.assigned ? '' : ' rr-idle'}`} onClick={() => setOpenPerson(r.user_id)}>
                <div className="rr-card-head">
                  <span className="rr-avatar">{initials(r.full_name)}</span>
                  <b>{r.full_name}</b><span className="muted small">{[r.team_name, r.role_name].filter(Boolean).join(' · ')}</span>
                </div>
                <div className="rr-nums">
                  <Num label="Assigned" v={r.assigned} />
                  <Num label="Completed" v={r.completed} tone="navy" />
                  <Num label="On time" v={r.on_time} tone="ok" />
                  <Num label="Late" v={r.late} tone={r.late ? 'warn' : ''} />
                  <Num label="Expired" v={r.expired} tone={r.expired ? 'bad' : ''} />
                  <Num label="Pending" v={r.pending} />
                </div>
                <div className="tr-meters">
                  <span className="muted small">Completion</span><Meter value={pct(r.completed, r.assigned)} />
                  <span className="muted small">On-time</span><Meter value={pct(r.on_time, r.completed)} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="muted small-note">Completion = completed ÷ assigned. On-time = on time ÷ completed. A task is on time when it's marked Done by its end time (or by the end of its due date). Meetings aren't counted. Dates are {formatDate(from)} to {formatDate(to)} (by due date).</p>

      {opened && <PersonTasks person={opened} from={from} to={to} onClose={() => setOpenPerson(null)} onOpen={onOpen} />}
    </>
  )
}

function Num({ label, v, tone = '' }: { label: string; v: number; tone?: string }) {
  return <div className={`rr-num ${tone}`}><span>{label}</span><b>{v}</b></div>
}

export function Meter({ value }: { value: number | null }) {
  if (value === null) return <span className="muted">—</span>
  const tone = value >= 80 ? 'good' : value >= 50 ? 'mid' : 'low'
  return (
    <div className={`meter ${tone}`}>
      <span className="meter-bar"><i style={{ width: `${value}%` }} /></span>
      <b>{value}%</b>
    </div>
  )
}

type ListFilter = 'all' | 'done' | Result
const RESULT_BADGE: Record<Result, string> = { 'On time': 'ok', Late: 'warn', Expired: 'bad', Pending: '' }

/** One person's tasks in the range, with the same filters as their card. */
function PersonTasks({ person, from, to, onClose, onOpen }: { person: PersonRow; from: string; to: string; onClose: () => void; onOpen?: (id: string) => void }) {
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [err, setErr] = useState('')
  const [f, setF] = useState<ListFilter>('all')
  useEffect(() => { fetchTasks(from, to, [person.user_id]).then(setTasks).catch((e) => setErr(String(e.message ?? e))) }, [from, to, person.user_id])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const list = tasks ?? []
  const count = (r: Result) => list.filter((t) => resultOf(t) === r).length
  const shown = list.filter((t) => f === 'all' || (f === 'done' ? t.status === 'done' : resultOf(t) === f))
    .sort((a, b) => (b.due_date ?? '').localeCompare(a.due_date ?? '') || b.task_no - a.task_no)
  const chips: [ListFilter, string, number][] = [
    ['all', 'All', list.length], ['done', 'Completed', list.filter((t) => t.status === 'done').length],
    ['On time', 'On time', count('On time')], ['Late', 'Late', count('Late')], ['Expired', 'Expired', count('Expired')], ['Pending', 'Pending', count('Pending')],
  ]
  return (
    <div className="dialog-wrap" onMouseDown={onClose}>
      <div className="dialog rr-modal" role="dialog" aria-label={`${person.full_name} tasks`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="rr-modal-head">
          <h3>{person.full_name} · Tasks</h3>
          <button className="icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <p className="muted small rr-modal-sum">
          {person.assigned} assigned · {person.completed} completed ({pctText(pct(person.completed, person.assigned))}) · {person.on_time} on time ({pctText(pct(person.on_time, person.completed))}) · {person.expired} expired · {person.pending} pending
        </p>
        <div className="rr-chips">
          {chips.map(([k, l, n]) => <button key={k} type="button" className={f === k ? 'on' : ''} onClick={() => setF(k)}>{l} ({n})</button>)}
        </div>
        {err && <div className="alert error">{err}</div>}
        <div className="table-scroll">
          {!tasks ? <div className="empty">Loading…</div> : shown.length === 0 ? <div className="empty">Nothing here.</div> : (
            <table className="rr-table">
              <thead><tr><th>#</th><th>Task</th><th>Due</th><th>Priority</th><th>Status</th><th>Result</th><th>Completed</th><th /></tr></thead>
              <tbody>
                {shown.map((t, i) => {
                  const r = resultOf(t)
                  return (
                    <tr key={t.id}>
                      <td>{i + 1}</td>
                      <td><b>{t.title}</b><TypeChip task={t} /><div className="muted small">{taskCode(t.task_no)} · by {t.assigner?.full_name ?? '—'}</div></td>
                      <td>{formatDate(t.due_date)}{t.start_time && <div className="muted small">{formatTimeRange(t.start_time, t.end_time)}</div>}</td>
                      <td>{PRIORITY_LABELS[t.priority]}</td>
                      <td>{STATUS_LABELS[t.status]}</td>
                      <td><span className={`rr-badge ${RESULT_BADGE[r]}`}>{r}</span></td>
                      <td>{t.completed_at ? new Date(t.completed_at).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', hour: 'numeric', minute: '2-digit' }) : '–'}</td>
                      <td>{onOpen && <button type="button" className="secondary small-btn" onClick={() => onOpen(t.id)}>Open</button>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

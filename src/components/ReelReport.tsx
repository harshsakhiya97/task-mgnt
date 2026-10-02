import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clapperboard, Clock3, Download, Eye, Gauge, Send, Target, Timer } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatDate, STATUS_LABELS, taskCode, todayStr, type TaskStatus } from '../lib/tasks'
import { minutesText, viewsText, type ReelReportRow } from '../lib/reels'
import { StatCard } from './StatCard'

const pct = (a: number | null, b: number | null) => (a == null || !b ? null : Math.round((a / b) * 100))

interface EditorRow {
  id: string; name: string; reels: number; done: number; posted: number
  expViews: number; views24: number; counted: number   // counted = reels with both an expected and an actual count
  expMin: number; actMin: number; timed: number          // timed = reels with an expected time and some actual time
}

/**
 * Reports → Reels (admin): expected vs actual views and expected vs actual edit time,
 * per editor and per reel, for reels due in the chosen dates.
 */
export function ReelReport({ from, to, teamId, onOpen }: { from: string; to: string; teamId: string; onOpen?: (taskId: string) => void }) {
  const [rows, setRows] = useState<ReelReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    if (!from || !to || from > to) return
    setLoading(true)
    const { data, error } = await supabase.rpc('report_reels', { p_from: from, p_to: to, p_team: teamId || null })
    if (error) setError(error.message)
    const list = (data as ReelReportRow[]) ?? []
    // Upload dates live on task_reels (not in the RPC).
    if (list.length) {
      const { data: up } = await supabase.from('task_reels').select('task_id, upload_date, sub_type').in('task_id', list.map((r) => r.task_id))
      const map = new Map(((up ?? []) as { task_id: string; upload_date: string | null; sub_type: string | null }[]).map((u) => [u.task_id, u]))
      for (const r of list) { const u = map.get(r.task_id); r.upload_date = u?.upload_date ?? null; r.sub_type = u?.sub_type ?? null }
    }
    setRows(list)
    setLoading(false)
  }, [from, to, teamId])
  useEffect(() => { load() }, [load])

  // Ratios only compare reels that have both numbers (a reel without an actual count doesn't pull the % down).
  const editors = useMemo(() => {
    const m = new Map<string, EditorRow>()
    for (const r of rows) {
      const id = r.editor_id ?? 'none'
      const e = m.get(id) ?? { id, name: r.editor_name ?? 'Unassigned', reels: 0, done: 0, posted: 0, expViews: 0, views24: 0, counted: 0, expMin: 0, actMin: 0, timed: 0 }
      e.reels++
      if (r.status === 'done') e.done++
      if (r.posted_at) e.posted++
      if (r.expected_views && r.views_24h != null) { e.expViews += r.expected_views; e.views24 += r.views_24h; e.counted++ }
      if (r.expected_minutes && r.actual_minutes > 0) { e.expMin += r.expected_minutes; e.actMin += r.actual_minutes; e.timed++ }
      m.set(id, e)
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [rows])

  const total = useMemo(() => editors.reduce((a, e) => ({
    reels: a.reels + e.reels, done: a.done + e.done, posted: a.posted + e.posted, expViews: a.expViews + e.expViews,
    views24: a.views24 + e.views24, counted: a.counted + e.counted, expMin: a.expMin + e.expMin, actMin: a.actMin + e.actMin, timed: a.timed + e.timed,
  }), { reels: 0, done: 0, posted: 0, expViews: 0, views24: 0, counted: 0, expMin: 0, actMin: 0, timed: 0 }), [editors])

  const exportExcel = async () => {
    setExporting(true); setError('')
    try {
      const { default: writeXlsxFile } = await import('write-excel-file')
      const head = (labels: string[]) => labels.map((value) => ({ value, fontWeight: 'bold' as const, backgroundColor: '#E8EAF6' }))
      const num = (v: number | null | undefined) => ({ value: v ?? undefined })
      const summary = [
        head(['Editor', 'Reels', 'Done', 'Posted', 'Expected views*', 'Actual views*', 'Views %', 'Expected time (min)**', 'Actual time (min)**', 'Time %']),
        ...editors.map((e) => [
          { value: e.name }, num(e.reels), num(e.done), num(e.posted), num(e.counted ? e.expViews : null), num(e.counted ? e.views24 : null),
          num(pct(e.views24, e.expViews)), num(e.timed ? e.expMin : null), num(e.timed ? e.actMin : null), num(pct(e.actMin, e.expMin)),
        ]),
        [],
        [{ value: '* Only reels with both an expected and an actual view count. ** Only reels with an expected time and some timed work.' }],
      ]
      const detail = [
        head(['Task No.', 'Video Title', 'Sub-type', 'Editor', 'Due Date', 'Upload Date', 'Status', 'Posted At', 'Instagram', 'YouTube', 'Expected Views', 'Actual Views', 'Views %', 'Expected Time (min)', 'Actual Time (min)', 'Time %']),
        ...rows.map((r) => [
          { value: taskCode(r.task_no) }, { value: r.title }, { value: r.sub_type ?? '' }, { value: r.editor_name ?? '' }, { value: formatDate(r.due_date) }, { value: r.upload_date ? formatDate(r.upload_date) : '' },
          { value: STATUS_LABELS[r.status as TaskStatus] ?? r.status },
          { value: r.posted_at ? new Date(r.posted_at).toLocaleString('en-IN') : '' },
          { value: r.instagram_url ?? '' }, { value: r.youtube_url ?? '' },
          num(r.expected_views), num(r.views_24h), num(pct(r.views_24h, r.expected_views)),
          num(r.expected_minutes), num(r.actual_minutes || null), num(r.actual_minutes ? pct(r.actual_minutes, r.expected_minutes) : null),
        ]),
      ]
      await writeXlsxFile([summary, detail], {
        sheets: ['Editors', 'Reels'],
        columns: [
          [{ width: 24 }, ...Array(9).fill({ width: 16 })],
          [{ width: 10 }, { width: 36 }, { width: 20 }, { width: 18 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 20 }, { width: 30 }, { width: 30 }, ...Array(7).fill({ width: 14 })],
        ],
        fileName: `Reels-Report_${from}_to_${to}.xlsx`,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setExporting(false)
    }
  }

  const viewsPct = pct(total.views24, total.expViews)
  const timePct = pct(total.actMin, total.expMin)

  return (
    <>
      {error && <div className="alert error" onClick={() => setError('')}>{error}</div>}
      <div className="stats tab-stats">
        <StatCard icon={Clapperboard} tone="navy" value={total.reels} label="Reels" />
        <StatCard icon={Send} tone="green" value={total.posted} label="Posted" />
        <StatCard icon={Target} tone="teal" value={total.counted ? viewsText(total.expViews) : '—'} label="Expected Views" />
        <StatCard icon={Eye} tone="blue" value={total.counted ? viewsText(total.views24) : '—'} label="Actual Views" />
        <StatCard icon={Gauge} tone="purple" value={viewsPct == null ? '—' : `${viewsPct}%`} label="Views vs Expected" />
        <StatCard icon={Clock3} tone="yellow" value={total.timed ? minutesText(total.expMin) : '—'} label="Expected Time" />
        <StatCard icon={Timer} tone="orange" value={total.timed ? minutesText(total.actMin) : '—'} label="Actual Time" />
        <StatCard icon={Gauge} tone={timePct != null && timePct > 100 ? 'red' : 'green'} value={timePct == null ? '—' : `${timePct}%`} label="Time vs Expected" />
      </div>

      <div className="panel">
        <div className="panel-toolbar">
          <span className="tab-chip">By editor</span>
          <span className="spacer" />
          <button onClick={exportExcel} disabled={exporting || loading || !rows.length}><Download size={17} /> {exporting ? 'Preparing…' : 'Export Excel'}</button>
        </div>
        <div className="table-scroll">
          {loading ? <div className="empty">Loading…</div> : rows.length === 0 ? (
            <div className="empty"><Clapperboard size={40} /><b>No reels in these dates</b>Add a reel with Tasks → Add Task → 🎬 Reel.</div>
          ) : (
            <table>
              <thead>
                <tr><th>Editor</th><th>Reels</th><th>Done</th><th>Posted</th><th>Expected Views</th><th>Actual Views</th><th>Views</th><th>Expected Time</th><th>Actual Time</th><th>Time</th></tr>
              </thead>
              <tbody>
                {editors.map((e) => (
                  <tr key={e.id}>
                    <td><b>{e.name}</b></td><td>{e.reels}</td><td>{e.done}</td><td>{e.posted}</td>
                    <td>{e.counted ? viewsText(e.expViews) : '—'}</td><td>{e.counted ? viewsText(e.views24) : '—'}</td>
                    <td><Ratio value={pct(e.views24, e.expViews)} /></td>
                    <td>{e.timed ? minutesText(e.expMin) : '—'}</td><td>{e.timed ? minutesText(e.actMin) : '—'}</td>
                    <td><Ratio value={pct(e.actMin, e.expMin)} time /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-toolbar"><span className="tab-chip">Each reel</span></div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Task No.</th><th>Video Title</th><th>Editor</th><th>Status</th><th>Upload Date</th><th>Posted</th><th>Expected Views</th><th>Actual Views</th><th>Expected Time</th><th>Actual Time</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const vp = pct(r.views_24h, r.expected_views)
                  const tp = r.actual_minutes ? pct(r.actual_minutes, r.expected_minutes) : null
                  return (
                    <tr key={r.task_id} className={onOpen ? 'clickable' : ''} onClick={() => onOpen?.(r.task_id)}>
                      <td className="task-no">{taskCode(r.task_no)}</td>
                      <td><div className="task-title" title={r.title}>{r.title}</div>{r.sub_type && <div className="muted small">{r.sub_type}</div>}</td>
                      <td>{r.editor_name ?? '—'}</td>
                      <td>{STATUS_LABELS[r.status as TaskStatus] ?? r.status}{r.timer_running && <div className="small ok-text">● editing now</div>}</td>
                      <td>{r.upload_date ? formatDate(r.upload_date) : '—'}</td>
                      <td>{r.posted_at ? formatDate(r.posted_at) : <span className="muted">Not yet</span>}
                        {r.posted_at && r.upload_date && todayStr(new Date(r.posted_at)) > r.upload_date && <div className="small overdue-text">after upload date</div>}</td>
                      <td>{viewsText(r.expected_views)}</td>
                      <td>{viewsText(r.views_24h)}{vp != null && <div className={`small ${vp >= 100 ? 'ok-text' : 'overdue-text'}`}>{vp}%</div>}</td>
                      <td>{minutesText(r.expected_minutes)}</td>
                      <td>{r.actual_minutes ? minutesText(r.actual_minutes) : '—'}{tp != null && <div className={`small ${tp <= 100 ? 'ok-text' : 'overdue-text'}`}>{tp}%</div>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="muted small-note">
        Actual views = the one count the editor adds about 24 hours after posting (Instagram + YouTube together).
        Views % = actual views ÷ expected; time % = actual edit time ÷ expected (under 100% is faster than planned).
        Totals and % only use reels that have both numbers. Dates are {formatDate(from)} to {formatDate(to)} (by due date).
      </p>
    </>
  )
}

/** Views: higher is better. Time (time=true): lower is better. */
function Ratio({ value, time }: { value: number | null; time?: boolean }) {
  if (value == null) return <span className="muted">—</span>
  const good = time ? value <= 100 : value >= 100
  const mid = time ? value <= 125 : value >= 70
  const tone = good ? 'good' : mid ? 'mid' : 'low'
  return (
    <div className={`meter ${tone}`}>
      <span className="meter-bar"><i style={{ width: `${Math.min(100, value)}%` }} /></span>
      <b>{value}%</b>
    </div>
  )
}

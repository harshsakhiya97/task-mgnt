import { useCallback, useEffect, useMemo, useState } from 'react'
import { CircleAlert, CircleCheck, Clapperboard, Download, ExternalLink, Eye, Send, Target, Timer, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatDate, STATUS_LABELS, taskCode, todayStr, type TaskStatus } from '../lib/tasks'
import { minutesText, viewsText, type ReelReportRow } from '../lib/reels'
import { StatCard } from './StatCard'
import { initials } from '../lib/initials'

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
  const [allRows, setRows] = useState<ReelReportRow[]>([])
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
      const { data: up } = await supabase.from('task_reels').select('task_id, upload_date, sub_type, drive_url').in('task_id', list.map((r) => r.task_id))
      const map = new Map(((up ?? []) as { task_id: string; upload_date: string | null; sub_type: string | null; drive_url: string | null }[]).map((u) => [u.task_id, u]))
      for (const r of list) { const u = map.get(r.task_id); r.upload_date = u?.upload_date ?? null; r.sub_type = u?.sub_type ?? null; r.drive_url = u?.drive_url ?? null }
    }
    setRows(list)
    setLoading(false)
  }, [from, to, teamId])
  useEffect(() => { load() }, [load])
  const [person, setPerson] = useState('')            // '' = everyone
  const [openPerson, setOpenPerson] = useState<string | null>(null)
  const rows = useMemo(() => (person ? allRows.filter((r) => (r.editor_id ?? 'none') === person) : allRows), [allRows, person])

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

  const counts = (list: ReelReportRow[]) => countRows(list)
  const all = counts(rows)
  const people = useMemo(() => {
    const m = new Map<string, { id: string; name: string; team: string | null; list: ReelReportRow[] }>()
    for (const r of allRows) {
      const id = r.editor_id ?? 'none'
      if (!m.has(id)) m.set(id, { id, name: r.editor_name ?? 'Unassigned', team: r.team_name, list: [] })
      m.get(id)!.list.push(r)
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [allRows])
  const shownPeople = person ? people.filter((p) => p.id === person) : people
  const opened = people.find((p) => p.id === openPerson)

  return (
    <>
      {error && <div className="alert error" onClick={() => setError('')}>{error}</div>}
      <div className="rr-toolbar">
        <select className="pill-select" value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Person">
          <option value="">Everyone</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span className="spacer" />
        <button onClick={exportExcel} disabled={exporting || loading || !rows.length}><Download size={17} /> {exporting ? 'Preparing…' : 'Export Excel'}</button>
      </div>

      <div className="stats tab-stats rr-stats">
        <StatCard icon={Clapperboard} tone="navy" value={all.total} label="Total Reels" />
        <StatCard icon={Target} tone="blue" value={all.est} label="Estimate Given" />
        <StatCard icon={CircleAlert} tone="orange" value={all.noEst} label="No Estimate" />
        <StatCard icon={CircleCheck} tone="green" value={all.result} label="Result In" />
        <StatCard icon={Eye} tone="orange" value={all.noResult} label="Result Pending" />
        <StatCard icon={Send} tone="green" value={all.up} label="Uploaded" />
        <StatCard icon={Send} tone="red" value={all.noUp} label="Not Uploaded" />
      </div>

      <div className="panel">
        <div className="panel-toolbar"><span className="tab-chip">Team results</span><span className="spacer" /><span className="muted small">Click a person to see their reels.</span></div>
        {loading ? <div className="empty">Loading…</div> : shownPeople.length === 0 ? (
          <div className="empty"><Clapperboard size={40} /><b>No reels in these dates</b>Add a reel with Tasks → Add Task → 🎬 Reel.</div>
        ) : (
          <div className="rr-grid">
            {shownPeople.map((p) => {
              const c = counts(p.list)
              return (
                <button key={p.id} type="button" className="rr-card" onClick={() => setOpenPerson(p.id)}>
                  <div className="rr-card-head">
                    <span className="rr-avatar">{initials(p.name)}</span>
                    <b>{p.name}</b>{p.team && <span className="muted small">{p.team}</span>}
                  </div>
                  <div className="rr-nums">
                    <Num label="Total" v={c.total} />
                    <Num label="Estimate given" v={c.est} tone="navy" />
                    <Num label="No estimate" v={c.noEst} tone={c.noEst ? 'warn' : ''} />
                    <Num label="Result in" v={c.result} tone="ok" />
                    <Num label="Result pending" v={c.noResult} tone={c.noResult ? 'warn' : ''} />
                    <Num label="Uploaded" v={c.up} tone="ok" />
                    <Num label="Not uploaded" v={c.noUp} tone={c.noUp ? 'warn' : ''} />
                  </div>
                  <div className="rr-foot">
                    <span><Eye size={14} /> {c.actual != null ? viewsText(c.actual) : '–'} / est {viewsText(c.expected)}</span>
                    <PctChip value={pct(c.actualOfEstimated, c.expectedWithResult)} />
                    {c.expMin > 0 && <span className="muted"><Timer size={13} /> {minutesText(c.actMin)} / {minutesText(c.expMin)}</span>}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
      <p className="muted small-note">
        Estimate = the editor's expected views. Result = the actual views (added ~24 h after posting). Uploaded = an Instagram / YouTube link is saved.
        Result pending / Not uploaded count reels that have an estimate. % compares actual with expected for reels that have both. Dates are {formatDate(from)} to {formatDate(to)} (by due date).
      </p>

      {opened && <PersonReels name={opened.name} list={opened.list} onClose={() => setOpenPerson(null)} onOpen={onOpen} />}
    </>
  )
}

/** Counts for a set of reels (Result pending / Not uploaded = among reels that have an estimate, like the old panel). */
function countRows(list: ReelReportRow[]) {
  const est = list.filter((r) => r.expected_views != null)
  const withResult = est.filter((r) => r.views_24h != null)
  const sum = (xs: (number | null)[]) => xs.reduce<number>((a, x) => a + (x ?? 0), 0)
  const actualAll = list.filter((r) => r.views_24h != null)
  return {
    total: list.length,
    est: est.length, noEst: list.length - est.length,
    result: actualAll.length, noResult: est.filter((r) => r.views_24h == null).length,
    up: list.filter(isUploaded).length, noUp: est.filter((r) => !isUploaded(r)).length,
    expected: sum(est.map((r) => r.expected_views)),
    actual: actualAll.length ? sum(actualAll.map((r) => r.views_24h)) : null,
    expectedWithResult: sum(withResult.map((r) => r.expected_views)),
    actualOfEstimated: sum(withResult.map((r) => r.views_24h)),
    expMin: sum(list.filter((r) => r.expected_minutes && r.actual_minutes).map((r) => r.expected_minutes)),
    actMin: sum(list.filter((r) => r.expected_minutes && r.actual_minutes).map((r) => r.actual_minutes)),
  }
}
const isUploaded = (r: ReelReportRow) => !!(r.posted_at || r.instagram_url || r.youtube_url)

function Num({ label, v, tone = '' }: { label: string; v: number; tone?: string }) {
  return <div className={`rr-num ${tone}`}><span>{label}</span><b>{v}</b></div>
}

function PctChip({ value }: { value: number | null }) {
  if (value == null) return null
  return <span className={`rr-pct ${value >= 100 ? 'up' : 'down'}`}>{value >= 100 ? '▲' : '▼'} {value}%</span>
}

type ListFilter = 'total' | 'est' | 'noEst' | 'result' | 'noResult' | 'up' | 'noUp'

/** One person's reels, with the same filters as their card. */
function PersonReels({ name, list, onClose, onOpen }: { name: string; list: ReelReportRow[]; onClose: () => void; onOpen?: (id: string) => void }) {
  const [f, setF] = useState<ListFilter>('total')
  const c = countRows(list)
  const match = (r: ReelReportRow) => {
    const est = r.expected_views != null
    switch (f) {
      case 'est': return est
      case 'noEst': return !est
      case 'result': return r.views_24h != null
      case 'noResult': return est && r.views_24h == null
      case 'up': return isUploaded(r)
      case 'noUp': return est && !isUploaded(r)
      default: return true
    }
  }
  const shown = list.filter(match).sort((a, b) => b.due_date.localeCompare(a.due_date))
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const chips: [ListFilter, string, number][] = [
    ['total', 'Total', c.total], ['est', 'Estimate given', c.est], ['noEst', 'No estimate', c.noEst], ['result', 'Result in', c.result],
    ['noResult', 'Result pending', c.noResult], ['up', 'Uploaded', c.up], ['noUp', 'Not uploaded', c.noUp],
  ]
  return (
    <div className="dialog-wrap" onMouseDown={onClose}>
      <div className="dialog rr-modal" role="dialog" aria-label={`${name} reels`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="rr-modal-head">
          <h3>{name} · Reels</h3>
          <button className="icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <p className="muted small rr-modal-sum">
          {c.total} reels · {c.est} with estimate · {c.result} results in · {c.up} uploaded · <Eye size={13} /> {c.actual != null ? viewsText(c.actual) : '–'} / est {viewsText(c.expected)}
        </p>
        <div className="rr-chips">
          {chips.map(([k, l, n]) => <button key={k} type="button" className={f === k ? 'on' : ''} onClick={() => setF(k)}>{l} ({n})</button>)}
        </div>
        <div className="table-scroll">
          {shown.length === 0 ? <div className="empty">Nothing here.</div> : (
            <table className="rr-table">
              <thead><tr><th>#</th><th>Reel</th><th>Due</th><th>Upload</th><th>Estimated</th><th>Actual</th><th>± Result</th><th /></tr></thead>
              <tbody>
                {shown.map((r, i) => {
                  const est = r.expected_views != null
                  const up = isUploaded(r)
                  const diff = est && r.views_24h != null ? pct(r.views_24h, r.expected_views) : null
                  return (
                    <tr key={r.task_id} className={est ? (up ? 'rr-up' : 'rr-noup') : ''}>
                      <td>{i + 1}</td>
                      <td>
                        <b>{r.title}</b> {r.drive_url && <a href={r.drive_url} target="_blank" rel="noopener noreferrer" title="Drive link" className="link-icon"><ExternalLink size={13} /></a>}
                        <div className="muted small">{taskCode(r.task_no)}{r.sub_type ? ` · ${r.sub_type}` : ''}</div>
                      </td>
                      <td>{formatDate(r.due_date)}</td>
                      <td>{up ? <span className="rr-badge ok">● Uploaded</span> : est ? <span className="rr-badge bad">● Not uploaded</span> : <span className="muted">–</span>}</td>
                      <td>{est ? viewsText(r.expected_views) : <span className="muted small">no estimate</span>}</td>
                      <td>{r.views_24h != null ? viewsText(r.views_24h) : est ? <span className="warn-text small">⚠ pending</span> : '–'}</td>
                      <td>{diff != null ? <PctChip value={diff} /> : '–'}</td>
                      <td>{onOpen && <button type="button" className="secondary small-btn" onClick={() => onOpen(r.task_id)}>Open</button>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        <p className="muted small">Red rows = estimate given but not uploaded yet · green = uploaded. Open a reel to add its links or actual views.</p>
      </div>
    </div>
  )
}

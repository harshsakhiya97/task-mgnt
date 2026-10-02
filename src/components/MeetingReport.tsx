import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, CircleCheck, Clock3, Download, FileText, ListTodo, Users, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatDate, formatTimeRange, taskCode } from '../lib/tasks'
import { minutesText } from '../lib/reels'
import { StatCard } from './StatCard'
import { initials } from '../lib/initials'

interface MPerson { id: string; name: string; team_id: string | null; team_name: string | null; organiser: boolean }
interface MAction { task_id: string; assigned_to: string | null; status: string; expired: boolean }
interface MeetingRow {
  task_id: string; task_no: number; title: string; due_date: string; start_time: string | null; end_time: string | null
  minutes: number; status: string; organiser_id: string; organiser_name: string | null; meeting_link: string | null
  has_notes: boolean; people: MPerson[]; actions: MAction[]
}

/** Counts for a list of meetings; with `pid`, action items are only the ones given to that person. */
function countMeetings(list: MeetingRow[], pid?: string) {
  const acts = list.flatMap((m) => m.actions).filter((a) => !pid || a.assigned_to === pid)
  return {
    total: list.length,
    organised: pid ? list.filter((m) => m.organiser_id === pid).length : list.length,
    invited: pid ? list.filter((m) => m.organiser_id !== pid).length : 0,
    minutes: list.reduce((s, m) => s + m.minutes, 0),
    peopleMinutes: list.reduce((s, m) => s + m.minutes * m.people.length, 0),
    notes: list.filter((m) => m.has_notes).length,
    noNotes: list.filter((m) => !m.has_notes).length,
    items: acts.length,
    done: acts.filter((a) => a.status === 'done').length,
    open: acts.filter((a) => a.status !== 'done').length,
    expired: acts.filter((a) => a.expired).length,
  }
}
const hours = (min: number) => (min ? minutesText(min) : '0h')

/**
 * Reports → Meetings (admin): meetings in the chosen dates — time spent in meetings, notes written,
 * and the action items they produced (done / open / expired), overall and per person.
 * "In a meeting" = organiser or invited (there's no attendance tracking).
 */
export function MeetingReport({ from, to, teamId, onOpen }: { from: string; to: string; teamId: string; onOpen?: (taskId: string) => void }) {
  const [rows, setRows] = useState<MeetingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [person, setPerson] = useState('')
  const [openPerson, setOpenPerson] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!from || !to || from > to) return
    setLoading(true)
    const { data, error } = await supabase.rpc('report_meetings', { p_from: from, p_to: to, p_team: teamId || null })
    if (error) setError(error.message)
    setRows((data as MeetingRow[]) ?? [])
    setLoading(false)
  }, [from, to, teamId])
  useEffect(() => { load() }, [load])

  // Everyone who organised or was invited to a meeting (only that team's people when a team is picked).
  const people = useMemo(() => {
    const m = new Map<string, { id: string; name: string; team: string | null; list: MeetingRow[] }>()
    for (const r of rows) for (const p of r.people) {
      if (teamId && p.team_id !== teamId) continue
      if (!m.has(p.id)) m.set(p.id, { id: p.id, name: p.name, team: p.team_name, list: [] })
      m.get(p.id)!.list.push(r)
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [rows, teamId])
  const picked = people.find((p) => p.id === person)
  const all = picked ? countMeetings(picked.list, picked.id) : countMeetings(rows)
  const shownPeople = picked ? [picked] : people
  const opened = people.find((p) => p.id === openPerson)

  const exportExcel = async () => {
    setExporting(true); setError('')
    try {
      const { default: writeXlsxFile } = await import('write-excel-file')
      const head = (labels: string[]) => labels.map((value) => ({ value, fontWeight: 'bold' as const, backgroundColor: '#E8EAF6' }))
      const num = (v: number) => ({ value: v })
      const h = (min: number) => ({ value: Math.round((min / 60) * 100) / 100 })
      const summary = [
        head(['Person', 'Team', 'Meetings', 'Organised', 'Invited', 'Hours in meetings', 'Action items', 'Done', 'Open', 'Expired']),
        ...people.map((p) => {
          const c = countMeetings(p.list, p.id)
          return [{ value: p.name }, { value: p.team ?? '' }, num(c.total), num(c.organised), num(c.invited), h(c.minutes), num(c.items), num(c.done), num(c.open), num(c.expired)]
        }),
      ]
      const list = picked ? picked.list : rows
      const detail = [
        head(['Task No.', 'Meeting', 'Date', 'Time', 'Hours', 'Organiser', 'People', 'Attendees', 'Notes', 'Action items', 'Done', 'Open', 'Expired', 'Link']),
        ...list.map((m) => {
          const c = countMeetings([m])
          return [
            { value: taskCode(m.task_no) }, { value: m.title }, { value: formatDate(m.due_date) }, { value: formatTimeRange(m.start_time, m.end_time) },
            h(m.minutes), { value: m.organiser_name ?? '' }, num(m.people.length), { value: m.people.filter((p) => !p.organiser).map((p) => p.name).join(', ') },
            { value: m.has_notes ? 'Yes' : 'No' }, num(c.items), num(c.done), num(c.open), num(c.expired), { value: m.meeting_link ?? '' },
          ]
        }),
      ]
      await writeXlsxFile([summary, detail], {
        sheets: ['People', 'Meetings'],
        columns: [
          [{ width: 24 }, { width: 14 }, ...Array(8).fill({ width: 14 })],
          [{ width: 10 }, { width: 36 }, { width: 12 }, { width: 20 }, { width: 8 }, { width: 18 }, { width: 8 }, { width: 40 }, { width: 8 }, ...Array(4).fill({ width: 12 }), { width: 34 }],
        ],
        fileName: `Meetings-Report_${from}_to_${to}.xlsx`,
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
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span className="spacer" />
        <button onClick={exportExcel} disabled={exporting || loading || !rows.length}><Download size={17} /> {exporting ? 'Preparing…' : 'Export Excel'}</button>
      </div>

      <div className="stats tab-stats rr-stats">
        <StatCard icon={CalendarClock} tone="navy" value={all.total} label="Total Meetings" />
        <StatCard icon={Clock3} tone="teal" value={hours(all.minutes)} label="Meeting Hours" />
        {picked
          ? <StatCard icon={Users} tone="blue" value={`${all.organised} / ${all.invited}`} label="Organised / Invited" />
          : <StatCard icon={Users} tone="blue" value={hours(all.peopleMinutes)} label="People Hours" />}
        <StatCard icon={FileText} tone={all.noNotes ? 'orange' : 'green'} value={`${all.notes} / ${all.total}`} label="With Notes" />
        <StatCard icon={ListTodo} tone="purple" value={all.items} label="Action Items" />
        <StatCard icon={CircleCheck} tone="green" value={all.done} label="Items Done" />
        <StatCard icon={ListTodo} tone={all.expired ? 'red' : 'yellow'} value={all.open} label={all.expired ? `Items Open · ${all.expired} expired` : 'Items Open'} />
      </div>

      <div className="panel">
        <div className="panel-toolbar"><span className="tab-chip">People in meetings</span><span className="spacer" /><span className="muted small">Click a person to see their meetings.</span></div>
        {loading ? <div className="empty">Loading…</div> : shownPeople.length === 0 ? (
          <div className="empty"><CalendarClock size={40} /><b>No meetings in these dates</b>Add one with Tasks → Add Task → 📅 Meeting.</div>
        ) : (
          <div className="rr-grid">
            {shownPeople.map((p) => {
              const c = countMeetings(p.list, p.id)
              return (
                <button key={p.id} type="button" className="rr-card" onClick={() => setOpenPerson(p.id)}>
                  <div className="rr-card-head">
                    <span className="rr-avatar">{initials(p.name)}</span>
                    <b>{p.name}</b>{p.team && <span className="muted small">{p.team}</span>}
                  </div>
                  <div className="rr-nums">
                    <Num label="Meetings" v={c.total} />
                    <Num label="Hours" v={hours(c.minutes)} tone="navy" />
                    <Num label="Organised" v={c.organised} />
                    <Num label="Invited" v={c.invited} />
                    <Num label="Action items done" v={c.done} tone="ok" />
                    <Num label="Action items open" v={c.open} tone={c.expired ? 'bad' : c.open ? 'warn' : ''} />
                  </div>
                  {c.expired > 0 && <div className="rr-foot"><span className="rr-badge bad">{c.expired} action item{c.expired === 1 ? '' : 's'} expired</span></div>}
                </button>
              )
            })}
          </div>
        )}
      </div>
      <p className="muted small-note">
        A person's meetings = the ones they organised or were invited to (attendance isn't tracked). Hours = the meetings' planned length.
        People Hours = each meeting's length × the people in it. Action items = tasks added from a meeting's Notes tab; a person's are the ones given to them.
        Dates are {formatDate(from)} to {formatDate(to)} (by meeting date).
      </p>

      {opened && <PersonMeetings id={opened.id} name={opened.name} list={opened.list} onClose={() => setOpenPerson(null)} onOpen={onOpen} />}
    </>
  )
}

function Num({ label, v, tone = '' }: { label: string; v: number | string; tone?: string }) {
  return <div className={`rr-num ${tone}`}><span>{label}</span><b>{v}</b></div>
}

type ListFilter = 'all' | 'organised' | 'invited' | 'notes' | 'noNotes' | 'open'

/** One person's meetings with filter chips. */
function PersonMeetings({ id, name, list, onClose, onOpen }: { id: string; name: string; list: MeetingRow[]; onClose: () => void; onOpen?: (id: string) => void }) {
  const [f, setF] = useState<ListFilter>('all')
  const c = countMeetings(list, id)
  const openFor = (m: MeetingRow) => m.actions.filter((a) => a.status !== 'done').length
  const match = (m: MeetingRow) => {
    switch (f) {
      case 'organised': return m.organiser_id === id
      case 'invited': return m.organiser_id !== id
      case 'notes': return m.has_notes
      case 'noNotes': return !m.has_notes
      case 'open': return openFor(m) > 0
      default: return true
    }
  }
  const shown = list.filter(match).sort((a, b) => (b.due_date + (b.start_time ?? '')).localeCompare(a.due_date + (a.start_time ?? '')))
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const chips: [ListFilter, string, number][] = [
    ['all', 'All', list.length], ['organised', 'Organised', c.organised], ['invited', 'Invited', c.invited],
    ['notes', 'With notes', c.notes], ['noNotes', 'No notes', c.noNotes], ['open', 'Open action items', list.filter((m) => openFor(m) > 0).length],
  ]
  return (
    <div className="dialog-wrap" onMouseDown={onClose}>
      <div className="dialog rr-modal" role="dialog" aria-label={`${name} meetings`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="rr-modal-head">
          <h3>{name} · Meetings</h3>
          <button className="icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <p className="muted small rr-modal-sum">
          {c.total} meeting{c.total === 1 ? '' : 's'} · {hours(c.minutes)} · organised {c.organised} · invited {c.invited} · action items given to {name.split(' ')[0]}: {c.done} done, {c.open} open{c.expired ? ` (${c.expired} expired)` : ''}
        </p>
        <div className="rr-chips">
          {chips.map(([k, l, n]) => <button key={k} type="button" className={f === k ? 'on' : ''} onClick={() => setF(k)}>{l} ({n})</button>)}
        </div>
        <div className="table-scroll">
          {shown.length === 0 ? <div className="empty">Nothing here.</div> : (
            <table className="rr-table">
              <thead><tr><th>#</th><th>Meeting</th><th>When</th><th>Organiser</th><th>People</th><th>Notes</th><th>Action items</th><th /></tr></thead>
              <tbody>
                {shown.map((m, i) => {
                  const mc = countMeetings([m])
                  return (
                    <tr key={m.task_id}>
                      <td>{i + 1}</td>
                      <td><b>{m.title}</b><div className="muted small">{taskCode(m.task_no)}{m.organiser_id === id ? ' · organiser' : ''}</div></td>
                      <td>{formatDate(m.due_date)}<div className="muted small">{formatTimeRange(m.start_time, m.end_time)} · {minutesText(m.minutes)}</div></td>
                      <td>{m.organiser_name ?? '—'}</td>
                      <td title={m.people.map((p) => p.name).join(', ')}>{m.people.length}</td>
                      <td>{m.has_notes ? <span className="rr-badge ok">✓ Notes</span> : <span className="muted small">No notes</span>}</td>
                      <td>{mc.items === 0 ? <span className="muted">–</span> : <>
                        {mc.done}/{mc.items} done{mc.expired > 0 && <> · <span className="rr-badge bad">{mc.expired} expired</span></>}
                      </>}</td>
                      <td>{onOpen && <button type="button" className="secondary small-btn" onClick={() => onOpen(m.task_id)}>Open</button>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        <p className="muted small">Open a meeting to read its notes or add action items.</p>
      </div>
    </div>
  )
}

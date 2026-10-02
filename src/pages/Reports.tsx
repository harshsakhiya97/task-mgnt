import { useEffect, useState } from 'react'
import { CalendarClock, Clapperboard, ClipboardList } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { SubTabs, useSubView } from '../components/SubTabs'
import { ReelReport } from '../components/ReelReport'
import { MeetingReport } from '../components/MeetingReport'
import { TaskReport } from '../components/TaskReport'
import { supabase } from '../lib/supabase'
import { addDays, todayStr } from '../lib/tasks'
import type { Team } from '../lib/types'

type Preset = 'today' | 'week' | 'month' | 'last_month' | 'custom'

function rangeFor(p: Preset): [string, string] {
  const today = todayStr()
  const d = new Date(today + 'T00:00:00')
  if (p === 'today') return [today, today]
  if (p === 'week') { const start = addDays(today, -d.getDay()); return [start, addDays(start, 6)] }   // Sun–Sat, like the calendar
  if (p === 'month') return [todayStr(new Date(d.getFullYear(), d.getMonth(), 1)), todayStr(new Date(d.getFullYear(), d.getMonth() + 1, 0))]
  return [todayStr(new Date(d.getFullYear(), d.getMonth() - 1, 1)), todayStr(new Date(d.getFullYear(), d.getMonth(), 0))]
}

export function Reports() {
  const [view, setView] = useSubView(['tasks', 'reels', 'meetings'] as const, 'tasks')
  const navigate = useNavigate()
  const [preset, setPreset] = useState<Preset>('month')
  const [[from, to], setRange] = useState<[string, string]>(() => rangeFor('month'))
  const [teams, setTeams] = useState<Team[]>([])
  const [teamId, setTeamId] = useState('')
  useEffect(() => {
    supabase.from('teams').select('id, name').order('name').then(({ data }) => setTeams((data as Team[]) ?? []))
  }, [])

  const pick = (p: Preset) => { setPreset(p); if (p !== 'custom') setRange(rangeFor(p)) }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Reports</h2>
          <p>{view === 'meetings'
            ? 'Meetings in the chosen dates: time spent in meetings, notes written and the action items they produced, overall and per person.'
            : view === 'reels'
            ? 'Reels due in the chosen dates: expected vs actual views (24 hours after posting) and expected vs actual edit time, per editor and per reel.'
            : 'Completion and on-time numbers per person, for tasks due in the chosen dates. A task is on time when it\'s marked Done by its end time (or by the end of its due date).'}</p>
        </div>
      </div>

      <SubTabs value={view} onChange={setView} options={[
        { value: 'tasks', label: 'Tasks', icon: ClipboardList },
        { value: 'reels', label: 'Reels', icon: Clapperboard },
        { value: 'meetings', label: 'Meetings', icon: CalendarClock },
      ]} />

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

      {view === 'meetings' ? <MeetingReport from={from} to={to} teamId={teamId} onOpen={(id) => navigate(`/tasks?task=${id}`)} />
        : view === 'reels' ? <ReelReport from={from} to={to} teamId={teamId} onOpen={(id) => navigate(`/tasks?task=${id}`)} />
        : <TaskReport from={from} to={to} teamId={teamId} onOpen={(id) => navigate(`/tasks?task=${id}`)} />}
    </>
  )
}

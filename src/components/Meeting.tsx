import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, Check, ExternalLink, Plus, UserRound, Video } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { formatDate, formatTimeRange, STATUS_LABELS, TASK_SELECT, taskCode, timeAgo, type Task, type TaskStatus } from '../lib/tasks'
import { RESPONSE_LABELS, type AttendeeResponse } from '../lib/meetings'
import { initials } from '../lib/initials'

type Props = { task: Task; onChanged: () => void; onError: (m: string) => void }

/** Meeting overview: when, link, organiser, attendees and their answers, and my own answer. */
export function MeetingOverview({ task, onChanged, onError }: Props) {
  const { profile } = useAuth()
  const me = task.attendees?.find((a) => a.user_id === profile?.id)
  const [busy, setBusy] = useState(false)
  const answer = async (r: AttendeeResponse) => {
    if (!profile) return
    setBusy(true)
    const { error } = await supabase.from('task_attendees').update({ response: r }).eq('task_id', task.id).eq('user_id', profile.id)
    setBusy(false)
    if (error) onError(error.message); else onChanged()
  }
  const link = task.meeting?.meeting_link
  const list = [...(task.attendees ?? [])].sort((a, b) => (a.person?.full_name ?? '').localeCompare(b.person?.full_name ?? ''))
  const going = list.filter((a) => a.response === 'going').length
  const declined = list.filter((a) => a.response === 'declined').length

  return (
    <div className="mt-card">
      <div className="mt-when">
        <CalendarClock size={20} />
        <div>
          <b>{formatDate(task.due_date)}{task.start_time ? ` · ${formatTimeRange(task.start_time, task.end_time)}` : ''}</b>
          <div className="muted small">Organiser: {task.assignee?.full_name ?? task.creator?.full_name ?? '—'}</div>
        </div>
        <span className="spacer" />
        {link && <a className="btn mt-join" href={link} target="_blank" rel="noopener noreferrer"><Video size={16} /> Join</a>}
      </div>
      {me && (
        <div className="mt-rsvp">
          <span className="small">Are you coming?</span>
          <button type="button" className={me.response === 'going' ? 'on going' : 'secondary'} disabled={busy} onClick={() => answer('going')}>Going</button>
          <button type="button" className={me.response === 'declined' ? 'on declined' : 'secondary'} disabled={busy} onClick={() => answer('declined')}>Can't make it</button>
        </div>
      )}
      <div className="mt-people">
        <div className="small muted">{list.length} attendee{list.length === 1 ? '' : 's'} · {going} going{declined ? ` · ${declined} can't make it` : ''}</div>
        {list.length === 0 ? <p className="muted small">No attendees yet. Edit the meeting to invite people.</p> : (
          <ul>
            {list.map((a) => (
              <li key={a.user_id}>
                <span className="att-avatar">{initials(a.person?.full_name ?? '?')}</span>
                <span>{a.person?.full_name ?? 'Someone'}</span>
                <span className={`mt-resp ${a.response}`}>{RESPONSE_LABELS[a.response]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** Notes tab: shared meeting notes (anyone in the meeting) + action items made from this meeting. */
export function MeetingNotes({ task, onChanged, onError, onAddAction, onOpenTask, reloadKey }: Props & {
  onAddAction: () => void; onOpenTask?: (id: string) => void; reloadKey?: number
}) {
  const { profile } = useAuth()
  const m = task.meeting
  const [notes, setNotes] = useState(m?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [items, setItems] = useState<Task[]>([])
  useEffect(() => { setNotes(m?.notes ?? '') }, [m?.notes])
  const loadItems = useCallback(async () => {
    const { data } = await supabase.from('tasks').select(TASK_SELECT).eq('meeting_id', task.id).order('task_no')
    setItems((data as Task[]) ?? [])
  }, [task.id])
  useEffect(() => { loadItems() }, [loadItems, reloadKey])

  const save = async () => {
    setBusy(true)
    const { error } = await supabase.from('task_meetings').update({ notes: notes.trim() || null }).eq('task_id', task.id)
    setBusy(false)
    if (error) return onError(error.message)
    setSaved(true); window.setTimeout(() => setSaved(false), 1500)
    onChanged()
  }
  const organiser = profile && (profile.id === task.created_by || profile.id === task.assigned_to || profile.role === 'admin')

  return (
    <>
      <div className="form-section">Meeting notes</div>
      <textarea rows={8} placeholder="What was discussed, decisions…" value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-notes" />
      <div className="inline-edit">
        <button type="button" disabled={busy || notes.trim() === (m?.notes ?? '')} onClick={save}>{busy ? 'Saving…' : 'Save notes'}</button>
        {saved && <span className="saved-tick"><Check size={14} /> Saved</span>}
        {m?.notes_updated_at && !saved && <span className="muted small">Last saved {timeAgo(m.notes_updated_at)}</span>}
      </div>

      <div className="form-section with-action mt-items-head">
        Action items <span className="tab-count">{items.length}</span>
        <span className="spacer" />
        {organiser && <button type="button" className="secondary small-btn" onClick={onAddAction}><Plus size={14} /> Add action item</button>}
      </div>
      {items.length === 0 ? <p className="muted small">No action items yet.{organiser ? ' Add one for each follow-up — it becomes a normal task for that person.' : ''}</p> : (
        <ul className="mt-items">
          {items.map((t) => (
            <li key={t.id} className={onOpenTask ? 'clickable' : ''} onClick={() => onOpenTask?.(t.id)}>
              <span className="task-no">{taskCode(t.task_no)}</span>
              <span className={t.status === 'done' ? 'mt-done' : ''}>{t.title}</span>
              <span className="muted small"><UserRound size={12} /> {t.assignee?.full_name ?? 'Unassigned'} · {formatDate(t.due_date)}</span>
              <span className={`badge st-${t.status}`}>{STATUS_LABELS[t.status as TaskStatus] ?? t.status}</span>
              {onOpenTask && <ExternalLink size={13} className="muted" />}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

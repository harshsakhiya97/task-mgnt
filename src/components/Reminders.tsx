import { useCallback, useEffect, useState } from 'react'
import { AlarmClock, Plus, X } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { PRIORITY_LABELS, type Task, type TaskPriority } from '../lib/tasks'
import {
  loadReminderRules, minutesLabel, REMINDER_PRESETS, REMINDER_SELECT, reminderTime, ruleText, whenText,
  type Reminder, type ReminderRule,
} from '../lib/reminders'

/** A reminder being set up (before it's saved). who: 'me' or 'assignee'; either minutes before the deadline or an exact time. */
export interface DraftReminder { who: 'me' | 'assignee'; minutes: number | null; at: string | null }

const localNow = () => { const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000); return d.toISOString().slice(0, 16) }

/** One line to add a reminder: [Remind me/assignee] [2 hrs before / at a time] [Add]. */
export function ReminderAdder({ canRemindAssignee, assigneeIsMe, hasDue, onAdd, busy }: {
  canRemindAssignee: boolean; assigneeIsMe?: boolean; hasDue: boolean; busy?: boolean
  onAdd: (d: DraftReminder) => void
}) {
  const [who, setWho] = useState<'me' | 'assignee'>('me')
  const [when, setWhen] = useState<string>(hasDue ? '120' : 'at')
  const [at, setAt] = useState('')
  useEffect(() => { if (!hasDue) setWhen('at') }, [hasDue])
  const add = () => {
    if (when === 'at') { if (!at) return; onAdd({ who, minutes: null, at: new Date(at).toISOString() }); setAt('') }
    else onAdd({ who, minutes: Number(when), at: null })
  }
  return (
    <div className="rem-adder">
      <select value={who} onChange={(e) => setWho(e.target.value as 'me' | 'assignee')} aria-label="Who gets the reminder">
        <option value="me">Remind me</option>
        {canRemindAssignee && !assigneeIsMe && <option value="assignee">Remind the assignee</option>}
      </select>
      <select value={when} onChange={(e) => setWhen(e.target.value)} aria-label="When">
        {hasDue && REMINDER_PRESETS.map((m) => <option key={m} value={m}>{minutesLabel(m)} before the deadline</option>)}
        <option value="at">At a date & time…</option>
      </select>
      {when === 'at' && <input type="datetime-local" min={localNow()} value={at} onChange={(e) => setAt(e.target.value)} aria-label="Reminder time" />}
      <button type="button" className="secondary small-btn" onClick={add} disabled={busy || (when === 'at' && !at)}><Plus size={14} /> Add</button>
    </div>
  )
}

/** "Urgent tasks get automatic reminders: the assignee 2 hrs before, you 1 hr before." */
export function AutoReminderNote({ priority, recurring }: { priority: TaskPriority; recurring?: boolean }) {
  const [rules, setRules] = useState<ReminderRule[]>([])
  useEffect(() => { loadReminderRules().then(setRules) }, [])
  if (recurring) return <p className="muted small rem-note">Recurring tasks don't have reminders.</p>
  const text = ruleText(rules.find((r) => r.priority === priority), 'you')
  return (
    <p className="muted small rem-note">
      <AlarmClock size={13} /> {text
        ? <>{PRIORITY_LABELS[priority]} tasks get automatic reminders: {text}. You can remove them in the task details.</>
        : <>{PRIORITY_LABELS[priority]} tasks have no automatic reminders.</>}
      {' '}The deadline is the task's end time, or 7:00 pm if it has no time.
    </p>
  )
}

/** Reminders added in the Add Task form (saved right after the task is created). */
export function DraftReminderList({ drafts, onChange, canRemindAssignee, assigneeIsMe, hasDue }: {
  drafts: DraftReminder[]; onChange: (d: DraftReminder[]) => void
  canRemindAssignee: boolean; assigneeIsMe: boolean; hasDue: boolean
}) {
  return (
    <div className="rem-box">
      {drafts.map((d, i) => (
        <div key={i} className="rem-row">
          <AlarmClock size={15} />
          <span className="rem-what"><b>{d.who === 'me' ? 'You' : 'Assignee'}</b> · {d.minutes ? `${minutesLabel(d.minutes)} before the deadline` : whenText(d.at ? new Date(d.at) : null)}</span>
          <button type="button" className="icon" onClick={() => onChange(drafts.filter((_, j) => j !== i))} aria-label="Remove reminder"><X size={15} /></button>
        </div>
      ))}
      <ReminderAdder canRemindAssignee={canRemindAssignee} assigneeIsMe={assigneeIsMe} hasDue={hasDue}
        onAdd={(d) => onChange([...drafts, d])} />
    </div>
  )
}

/** Save the form's reminders for a newly created task. */
export async function saveDraftReminders(taskId: string, meId: string, drafts: DraftReminder[]) {
  if (!drafts.length) return null
  const { error } = await supabase.from('task_reminders').insert(drafts.map((d) => ({
    task_id: taskId, target: d.who === 'me' ? 'person' : 'assignee', person_id: d.who === 'me' ? meId : null,
    minutes_before: d.minutes, remind_at: d.at,
  })))
  return error?.message ?? null
}

/** Task details → Reminders: list, add and remove. */
export function TaskReminders({ task, onError }: { task: Task; onError: (m: string) => void }) {
  const { profile } = useAuth()
  const [list, setList] = useState<Reminder[]>([])
  const [busy, setBusy] = useState(false)
  const me = profile?.id
  const isAdmin = profile?.role === 'admin'
  const canRemindAssignee = !!me && (isAdmin || me === task.assigned_by || me === task.created_by)

  const load = useCallback(async () => {
    const { data } = await supabase.from('task_reminders').select(REMINDER_SELECT).eq('task_id', task.id).order('created_at')
    setList((data as unknown as Reminder[]) ?? [])
  }, [task.id])
  useEffect(() => { load() }, [load, task.due_date, task.end_time, task.priority])

  if (task.recurring_id) return null

  const add = async (d: DraftReminder) => {
    if (!me) return
    setBusy(true)
    const err = await saveDraftReminders(task.id, me, [d])
    setBusy(false)
    if (err) onError(err); else load()
  }
  const remove = async (r: Reminder) => {
    const { error } = await supabase.from('task_reminders').delete().eq('id', r.id)
    if (error) onError(error.message); else setList((l) => l.filter((x) => x.id !== r.id))
  }
  const canRemove = (r: Reminder) => !!me && (isAdmin || r.created_by === me || r.person_id === me || me === task.assigned_by || me === task.created_by)
  const who = (r: Reminder) => r.target === 'assignee'
    ? (task.assigned_to === me ? 'You (assignee)' : `Assignee${task.assignee ? ` (${task.assignee.full_name})` : ''}`)
    : r.person_id === me ? 'You' : r.person?.full_name ?? 'Someone'

  return (
    <>
      <div className="form-section">Reminders</div>
      <div className="rem-box">
        {list.length === 0 && <p className="muted small">No reminders on this task.</p>}
        {list.map((r) => {
          const at = reminderTime(r, task)
          return (
            <div key={r.id} className={`rem-row ${r.sent_at || r.skipped ? 'done' : ''}`}>
              <AlarmClock size={15} />
              <span className="rem-what">
                <b>{who(r)}</b> · {r.minutes_before ? `${minutesLabel(r.minutes_before)} before the deadline` : 'at a set time'}
                <span className="muted"> · {whenText(at)}</span>
                {r.auto && <span className="tag">Auto</span>}
              </span>
              <span className="rem-state small">
                {r.sent_at ? <span className="ok-text">Sent</span>
                  : r.skipped ? <span className="muted rem-skip" title={r.skipped}>Not sent: {r.skipped.charAt(0).toLowerCase() + r.skipped.slice(1)}</span>
                  : <span className="muted">Pending</span>}
              </span>
              {canRemove(r) && !r.sent_at && (
                <button type="button" className="icon" onClick={() => remove(r)} aria-label="Remove reminder" title="Remove reminder"><X size={15} /></button>
              )}
            </div>
          )
        })}
        {task.status !== 'done' && (
          <ReminderAdder canRemindAssignee={canRemindAssignee && !!task.assigned_to} assigneeIsMe={task.assigned_to === me}
            hasDue={!!task.due_date} onAdd={add} busy={busy} />
        )}
      </div>
    </>
  )
}

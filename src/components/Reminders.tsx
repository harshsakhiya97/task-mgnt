import { useCallback, useEffect, useState } from 'react'
import { AlarmClock, Plus, X } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { PRIORITY_LABELS, type Task, type TaskPriority } from '../lib/tasks'
import {
  loadReminderRules, minutesLabel, offsetText, RELATIONS, REMINDER_PRESETS, REMINDER_SELECT, reminderTime, ruleText, whenText,
  type Anchor, type Direction, type Reminder, type ReminderRule,
} from '../lib/reminders'

/** A reminder being set up (before it's saved). who: 'me' or 'assignee';
 *  either N minutes before/after the task's start/end, or an exact time (`at`). */
export interface DraftReminder { who: 'me' | 'assignee'; minutes: number | null; direction: Direction; anchor: Anchor; at: string | null }

/** "30 min before the start" / "Fri, 3 Oct, 4:00 pm" for a draft. */
const draftText = (d: DraftReminder) => d.minutes != null ? offsetText(d.minutes, d.direction, d.anchor) : whenText(d.at ? new Date(d.at) : null)

const localNow = () => { const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000); return d.toISOString().slice(0, 16) }

/** One line to add a reminder: [Remind me/assignee] [30 min] [before the start / after the end …] [Add],
 *  or [At a date & time…] [date-time]. */
export function ReminderAdder({ canRemindAssignee, assigneeIsMe, assigneeName, hasDue, hasStart = true, onAdd, busy }: {
  canRemindAssignee: boolean; assigneeIsMe?: boolean; assigneeName?: string; hasDue: boolean
  /** The task has a start time (start-based reminders need one). */
  hasStart?: boolean; busy?: boolean
  onAdd: (d: DraftReminder) => void
}) {
  const [who, setWho] = useState<'me' | 'assignee'>('me')
  const [when, setWhen] = useState<string>(hasDue ? '120' : 'at')
  const [rel, setRel] = useState('before:end')
  const [at, setAt] = useState('')
  useEffect(() => { if (!hasDue) setWhen('at') }, [hasDue])
  useEffect(() => { if (when === '0' && rel.startsWith('after')) setRel(rel.replace('after', 'before')) }, [when, rel])
  const relation = RELATIONS.find((r) => r.value === rel) ?? RELATIONS[2]
  const add = () => {
    if (when === 'at') { if (!at) return; onAdd({ who, minutes: null, direction: 'before', anchor: 'end', at: new Date(at).toISOString() }); setAt('') }
    else onAdd({ who, minutes: Number(when), direction: relation.direction, anchor: relation.anchor, at: null })
  }
  return (
    <div className="rem-adder">
      <select value={who} onChange={(e) => setWho(e.target.value as 'me' | 'assignee')} aria-label="Who gets the reminder">
        <option value="me">Remind me</option>
        {canRemindAssignee && !assigneeIsMe && <option value="assignee">{assigneeName ? `Remind ${assigneeName}` : 'Remind the assignee'}</option>}
      </select>
      <select value={when} onChange={(e) => setWhen(e.target.value)} aria-label="How long">
        {hasDue && REMINDER_PRESETS.map((m) => <option key={m} value={m}>{m === 0 ? 'Right' : minutesLabel(m)}</option>)}
        <option value="at">At a date & time…</option>
      </select>
      {when !== 'at' && (
        <select value={rel} onChange={(e) => setRel(e.target.value)} aria-label="Before or after the start or end">
          {(when === '0' ? RELATIONS.filter((r) => r.direction === 'before') : RELATIONS).map((r) => (
            <option key={r.value} value={r.value}>
              {when === '0' ? `at the ${r.anchor}` : r.label}{r.anchor === 'start' && !hasStart ? ' (needs a start time)' : ''}
            </option>
          ))}
        </select>
      )}
      {when === 'at' && <input type="datetime-local" min={localNow()} value={at} onChange={(e) => setAt(e.target.value)} aria-label="Reminder time" />}
      <button type="button" className="secondary small-btn" onClick={add} disabled={busy || (when === 'at' && !at)}><Plus size={14} /> Add</button>
    </div>
  )
}

/** "Urgent tasks get automatic reminders: the assignee 2 hrs before, you 1 hr before."
 *  With `prefilled`, the Add Task form already lists them as rows, so the note just says where they come from. */
export function AutoReminderNote({ priority, recurring, prefilled }: { priority: TaskPriority; recurring?: boolean; prefilled?: boolean }) {
  const [rules, setRules] = useState<ReminderRule[]>([])
  useEffect(() => { loadReminderRules().then(setRules) }, [])
  if (recurring) return <p className="muted small rem-note"><span>Recurring tasks don't have reminders.</span></p>
  const text = ruleText(rules.find((r) => r.priority === priority), 'you')
  if (prefilled) {
    return (
      <p className="muted small rem-note">
        <AlarmClock size={13} />
        <span>{text
          ? <>Reminders marked <b>Auto</b> are added for {PRIORITY_LABELS[priority].toLowerCase()} tasks. Remove any you don't need, or add more.</>
          : <>{PRIORITY_LABELS[priority]} tasks have no automatic reminders. You can add your own.</>}
        {' '}The end is the task's end time (7:00 pm if it has no time); the start is its start time.</span>
      </p>
    )
  }
  return (
    <p className="muted small rem-note">
      <AlarmClock size={13} />
      <span>{text
        ? <>{PRIORITY_LABELS[priority]} tasks get automatic reminders: {text}. You can remove them in the task details.</>
        : <>{PRIORITY_LABELS[priority]} tasks have no automatic reminders.</>}
      {' '}The end is the task's end time (7:00 pm if it has no time); the start is its start time.</span>
    </p>
  )
}

/** An automatic reminder shown in the Add Task form (from Settings → Reminders). The database adds it when the task is created. */
export type AutoKey = 'assignee' | 'assigner'
export interface AutoDraft extends DraftReminder { key: AutoKey }

/** The automatic reminders a new task will get for this priority (assigner's one skipped for a task you give yourself). */
export function autoDrafts(rule: ReminderRule | undefined, assigneeIsMe: boolean): AutoDraft[] {
  if (!rule) return []
  const list: AutoDraft[] = []
  if (rule.assignee_minutes != null) list.push({ key: 'assignee', who: 'assignee', minutes: rule.assignee_minutes, direction: rule.assignee_direction, anchor: rule.assignee_anchor, at: null })
  if (rule.assigner_minutes != null && !assigneeIsMe) list.push({ key: 'assigner', who: 'me', minutes: rule.assigner_minutes, direction: rule.assigner_direction, anchor: rule.assigner_anchor, at: null })
  return list
}

/** Reminders added in the Add Task form (saved right after the task is created). */
export function DraftReminderList({ drafts, onChange, canRemindAssignee, assigneeIsMe, assigneeName, hasDue, hasStart, auto = [], onRemoveAuto }: {
  drafts: DraftReminder[]; onChange: (d: DraftReminder[]) => void
  canRemindAssignee: boolean; assigneeIsMe: boolean; assigneeName?: string; hasDue: boolean; hasStart?: boolean
  auto?: AutoDraft[]; onRemoveAuto?: (k: AutoKey) => void
}) {
  const who = (d: DraftReminder) => d.who === 'me' || assigneeIsMe ? 'Remind me' : `Remind ${assigneeName ?? 'the assignee'}`
  return (
    <div className="rem-box">
      {auto.map((d) => (
        <div key={d.key} className="rem-row">
          <AlarmClock size={15} />
          <span className="rem-what"><b>{who(d)}</b> · {draftText(d).toLowerCase()} <span className="tag">Auto</span>{noStart(d, hasStart)}</span>
          <button type="button" className="icon" onClick={() => onRemoveAuto?.(d.key)} aria-label="Remove reminder" title="Remove reminder"><X size={15} /></button>
        </div>
      ))}
      {drafts.map((d, i) => (
        <div key={i} className="rem-row">
          <AlarmClock size={15} />
          <span className="rem-what"><b>{who(d)}</b> · {d.minutes != null ? draftText(d).toLowerCase() : draftText(d)}{noStart(d, hasStart)}</span>
          <button type="button" className="icon" onClick={() => onChange(drafts.filter((_, j) => j !== i))} aria-label="Remove reminder"><X size={15} /></button>
        </div>
      ))}
      <ReminderAdder canRemindAssignee={canRemindAssignee} assigneeIsMe={assigneeIsMe} assigneeName={assigneeName} hasDue={hasDue}
        hasStart={hasStart} onAdd={(d) => onChange([...drafts, d])} />
    </div>
  )
}

/** "(needs a start time)" note for a start-based reminder on a task without one. */
function noStart(d: Pick<DraftReminder, 'minutes' | 'anchor'>, hasStart?: boolean) {
  return d.minutes != null && d.anchor === 'start' && hasStart === false
    ? <span className="rem-warn"> · needs a start time, won't be sent without one</span> : null
}

/** Save the form's reminders for a newly created task. */
export async function saveDraftReminders(taskId: string, meId: string, drafts: DraftReminder[]) {
  if (!drafts.length) return null
  const { error } = await supabase.from('task_reminders').insert(drafts.map((d) => ({
    task_id: taskId, target: d.who === 'me' ? 'person' : 'assignee', person_id: d.who === 'me' ? meId : null,
    minutes_before: d.minutes, remind_at: d.at, direction: d.direction, anchor: d.anchor,
  })))
  return error?.message ?? null
}

/** Remove the automatic reminders the user took out in the Add Task form (the database added them with the task). */
export async function dropAutoReminders(taskId: string, assignerId: string, keys: AutoKey[]) {
  for (const k of keys) {
    const q = supabase.from('task_reminders').delete().eq('task_id', taskId).eq('auto', true)
    const { error } = k === 'assignee' ? await q.eq('target', 'assignee') : await q.eq('target', 'person').eq('person_id', assignerId)
    if (error) return error.message
  }
  return null
}

/** Task details → Reminders: list, add and remove. */
/** Edit Task with a new priority: the Auto reminders that task will get when it's saved (shown before saving). */
export interface AutoPreview { rows: (AutoDraft & { label: string })[]; onRemove: (k: AutoKey) => void }

export function TaskReminders({ task, onError, preview, heading = true, onCount }: {
  task: Task; onError: (m: string) => void; preview?: AutoPreview
  /** Show the "Reminders" section title (off in the task's Reminders tab). */
  heading?: boolean
  /** Tells the parent how many reminders the task has (for the tab's count). */
  onCount?: (n: number) => void
}) {
  const { profile } = useAuth()
  const [list, setList] = useState<Reminder[]>([])
  const [busy, setBusy] = useState(false)
  const me = profile?.id
  const isAdmin = profile?.role === 'admin'
  const canRemindAssignee = !!me && (isAdmin || me === task.assigned_by || me === task.created_by)

  const load = useCallback(async () => {
    const { data } = await supabase.from('task_reminders').select(REMINDER_SELECT).eq('task_id', task.id).order('created_at')
    setList((data as unknown as Reminder[]) ?? [])
    onCount?.((data ?? []).length)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id])
  useEffect(() => { load() }, [load, task.due_date, task.start_time, task.end_time, task.priority])

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
    if (error) onError(error.message); else setList((l) => { const n = l.filter((x) => x.id !== r.id); onCount?.(n.length); return n })
  }
  const canRemove = (r: Reminder) => !!me && (isAdmin || r.created_by === me || r.person_id === me || me === task.assigned_by || me === task.created_by)
  const who = (r: Reminder) => r.target === 'assignee'
    ? (task.assigned_to === me ? 'Remind me' : `Remind ${task.assignee?.full_name ?? 'the assignee'}`)
    : r.person_id === me ? 'Remind me' : `Remind ${r.person?.full_name ?? 'someone'}`

  return (
    <>
      {heading && <div className="form-section">Reminders</div>}
      <div className="rem-box">
        {/* With a preview, the old priority's pending Auto reminders are about to be replaced, so they're hidden. */}
        {(preview ? list.filter((r) => !(r.auto && !r.sent_at && !r.skipped)) : list).length === 0 && !preview?.rows.length
          && <p className="muted small">No reminders on this task.</p>}
        {preview?.rows.map((d) => (
          <div key={d.key} className="rem-row">
            <AlarmClock size={15} />
            <span className="rem-what"><b>{d.label}</b> · {draftText(d).toLowerCase()} <span className="tag">Auto</span>{noStart(d, !!task.start_time)}</span>
            <span className="rem-state small"><span className="muted">Added when you click Update</span></span>
            <button type="button" className="icon" onClick={() => preview.onRemove(d.key)} aria-label="Remove reminder" title="Remove reminder"><X size={15} /></button>
          </div>
        ))}
        {(preview ? list.filter((r) => !(r.auto && !r.sent_at && !r.skipped)) : list).map((r) => {
          const at = reminderTime(r, task)
          return (
            <div key={r.id} className={`rem-row ${r.sent_at || r.skipped ? 'done' : ''}`}>
              <AlarmClock size={15} />
              <span className="rem-what">
                <b>{who(r)}</b> · {r.minutes_before != null ? offsetText(r.minutes_before, r.direction, r.anchor).toLowerCase() : 'at a set time'}
                <span className="muted"> · {at ? whenText(at) : 'no start time yet'}</span>
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
            assigneeName={task.assignee?.full_name}
            hasDue={!!task.due_date} hasStart={!!task.start_time} onAdd={add} busy={busy} />
        )}
      </div>
    </>
  )
}

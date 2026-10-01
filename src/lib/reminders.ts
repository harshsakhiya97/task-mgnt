import { supabase } from './supabase'
import type { TaskPriority } from './tasks'

/** Before or after… */
export type Direction = 'before' | 'after'
/** …the task's start (start time on the due date) or end (end time, or 7:00 pm if it has no time). */
export type Anchor = 'start' | 'end'

/** A reminder on a task (table task_reminders). "N min before/after the start/end" reminders move with the task's date/time. */
export interface Reminder {
  id: string
  task_id: string
  target: 'assignee' | 'person'
  person_id: string | null
  minutes_before: number | null
  remind_at: string | null
  direction: Direction
  anchor: Anchor
  auto: boolean
  created_by: string | null
  created_at: string
  sent_at: string | null
  skipped: string | null
  person?: { full_name: string } | null
}
export const REMINDER_SELECT = '*, person:profiles!task_reminders_person_id_fkey(full_name)'

export interface ReminderRule {
  priority: TaskPriority
  assignee_minutes: number | null; assignee_direction: Direction; assignee_anchor: Anchor
  assigner_minutes: number | null; assigner_direction: Direction; assigner_anchor: Anchor
}

/** Amounts shown in "Remind …" (0 = right at the start / end). */
export const REMINDER_PRESETS = [0, 10, 15, 30, 60, 120, 180, 240, 1440]

/** The four "when" choices: before/after × start/end. */
export const RELATIONS: { value: string; direction: Direction; anchor: Anchor; label: string }[] = [
  { value: 'before:start', direction: 'before', anchor: 'start', label: 'before the start' },
  { value: 'after:start', direction: 'after', anchor: 'start', label: 'after the start' },
  { value: 'before:end', direction: 'before', anchor: 'end', label: 'before the end' },
  { value: 'after:end', direction: 'after', anchor: 'end', label: 'after the end' },
]

/** "30 min before the start", "1 hr after the end", "At the start". */
export function offsetText(minutes: number, direction: Direction, anchor: Anchor) {
  if (!minutes) return anchor === 'start' ? 'At the start' : 'At the end'
  return `${minutesLabel(minutes)} ${direction} the ${anchor}`
}

/** 30 → "30 min", 60 → "1 hr", 120 → "2 hrs", 1440 → "1 day". */
export function minutesLabel(m: number) {
  if (m === 0) return '0 min'
  if (m % 1440 === 0) return m === 1440 ? '1 day' : `${m / 1440} days`
  if (m % 60 === 0) return m === 60 ? '1 hr' : `${m / 60} hrs`
  if (m > 60) return `${Math.floor(m / 60)} hr ${m % 60} min`
  return `${m} min`
}

/** The moment a task is due: its end time on the due date, or 7:00 pm (India) if it has no time. */
export function taskDeadline(t: { due_date: string | null; end_time: string | null }): Date | null {
  if (!t.due_date) return null
  const tm = t.end_time ?? '19:00:00'
  return new Date(`${t.due_date}T${tm.length === 5 ? `${tm}:00` : tm.slice(0, 8)}+05:30`)
}

/** The moment a task starts: its start time on the due date (India), or null if it has no start time. */
export function taskStart(t: { due_date: string | null; start_time: string | null }): Date | null {
  if (!t.due_date || !t.start_time) return null
  const tm = t.start_time
  return new Date(`${t.due_date}T${tm.length === 5 ? `${tm}:00` : tm.slice(0, 8)}+05:30`)
}

/** When this reminder goes out (null = never, e.g. "before the start" on a task with no start time). */
export function reminderTime(
  r: Pick<Reminder, 'minutes_before' | 'remind_at'> & Partial<Pick<Reminder, 'direction' | 'anchor'>>,
  t: { due_date: string | null; start_time?: string | null; end_time: string | null },
): Date | null {
  if (r.remind_at) return new Date(r.remind_at)
  const base = r.anchor === 'start' ? taskStart({ due_date: t.due_date, start_time: t.start_time ?? null }) : taskDeadline(t)
  if (!base || r.minutes_before == null) return null
  return new Date(base.getTime() + (r.direction === 'after' ? 1 : -1) * r.minutes_before * 60_000)
}

export const whenText = (d: Date | null) =>
  d ? d.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—'

let rulesCache: Promise<ReminderRule[]> | null = null
/** Automatic reminder rules per priority (Settings → Reminders). */
export function loadReminderRules(fresh = false): Promise<ReminderRule[]> {
  if (!rulesCache || fresh) {
    rulesCache = Promise.resolve(supabase.from('reminder_rules')
      .select('priority, assignee_minutes, assignee_direction, assignee_anchor, assigner_minutes, assigner_direction, assigner_anchor'))
      .then(({ data }) => (data ?? []) as ReminderRule[])
  }
  return rulesCache
}

/** "assignee 2 hrs before, the assigner 1 hr before" for a rule, or '' when it has none. */
export function ruleText(r: ReminderRule | undefined, assignerLabel = 'the assigner') {
  if (!r) return ''
  const parts = [
    r.assignee_minutes != null ? `the assignee ${offsetText(r.assignee_minutes, r.assignee_direction, r.assignee_anchor).toLowerCase()}` : '',
    r.assigner_minutes != null ? `${assignerLabel} ${offsetText(r.assigner_minutes, r.assigner_direction, r.assigner_anchor).toLowerCase()}` : '',
  ].filter(Boolean)
  return parts.join(', ')
}

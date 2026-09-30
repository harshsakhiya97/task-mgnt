import { supabase } from './supabase'
import type { TaskPriority } from './tasks'

/** A reminder on a task (table task_reminders). "Before deadline" reminders move with the task's date/time. */
export interface Reminder {
  id: string
  task_id: string
  target: 'assignee' | 'person'
  person_id: string | null
  minutes_before: number | null
  remind_at: string | null
  auto: boolean
  created_by: string | null
  created_at: string
  sent_at: string | null
  skipped: string | null
  person?: { full_name: string } | null
}
export const REMINDER_SELECT = '*, person:profiles!task_reminders_person_id_fkey(full_name)'

export interface ReminderRule { priority: TaskPriority; assignee_minutes: number | null; assigner_minutes: number | null }

/** Choices shown in "Remind …" (minutes before the deadline). */
export const REMINDER_PRESETS = [30, 60, 120, 180, 240, 1440]

/** 30 → "30 min", 60 → "1 hr", 120 → "2 hrs", 1440 → "1 day". */
export function minutesLabel(m: number) {
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

/** When this reminder goes out. */
export function reminderTime(r: Pick<Reminder, 'minutes_before' | 'remind_at'>, t: { due_date: string | null; end_time: string | null }): Date | null {
  if (r.remind_at) return new Date(r.remind_at)
  const d = taskDeadline(t)
  return d && r.minutes_before != null ? new Date(d.getTime() - r.minutes_before * 60_000) : null
}

export const whenText = (d: Date | null) =>
  d ? d.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—'

let rulesCache: Promise<ReminderRule[]> | null = null
/** Automatic reminder rules per priority (Settings → Reminders). */
export function loadReminderRules(fresh = false): Promise<ReminderRule[]> {
  if (!rulesCache || fresh) {
    rulesCache = Promise.resolve(supabase.from('reminder_rules').select('priority, assignee_minutes, assigner_minutes'))
      .then(({ data }) => (data ?? []) as ReminderRule[])
  }
  return rulesCache
}

/** "assignee 2 hrs before, the assigner 1 hr before" for a rule, or '' when it has none. */
export function ruleText(r: ReminderRule | undefined, assignerLabel = 'the assigner') {
  if (!r) return ''
  const parts = [
    r.assignee_minutes ? `the assignee ${minutesLabel(r.assignee_minutes)} before` : '',
    r.assigner_minutes ? `${assignerLabel} ${minutesLabel(r.assigner_minutes)} before` : '',
  ].filter(Boolean)
  return parts.join(', ')
}

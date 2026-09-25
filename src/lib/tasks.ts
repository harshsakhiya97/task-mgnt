import { supabase } from './supabase'

export type TaskStatus = 'todo' | 'in_progress' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do', in_progress: 'In Progress', done: 'Done',
}
export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent',
}

export type TaskType = 'adhoc' | 'recurring'
export const TYPE_LABELS: Record<TaskType, string> = { adhoc: 'Ad hoc', recurring: 'Recurring' }

/** Due-date tag: Ongoing (not done, not past due), Expired (not done, past due), Completed (done). */
export type DueTag = 'ongoing' | 'expired' | 'completed'
export const DUE_TAG_LABELS: Record<DueTag, string> = { ongoing: 'Ongoing', expired: 'Expired', completed: 'Completed' }

export interface RecurringTask {
  id: string
  title: string
  description: string | null
  priority: TaskPriority
  created_by: string
  assigned_to: string
  weekdays: number[]             // 0 = Sunday … 6 = Saturday
  start_date: string
  end_date: string | null
  is_active: boolean
  start_time: string | null      // default time for each day's copy
  end_time: string | null
  created_at: string
  assignee: PersonRef | null
  creator: PersonRef | null
}

export const RECURRING_SELECT =
  '*, assignee:profiles!recurring_tasks_assigned_to_fkey(id, full_name), creator:profiles!recurring_tasks_created_by_fkey(id, full_name)'

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function weekdayNames(days: number[]) {
  const d = [...new Set(days)].sort()
  const has = (xs: number[]) => xs.every((x) => d.includes(x))
  if (d.length === 7) return 'Every day'
  if (d.length === 6 && has([1, 2, 3, 4, 5, 6])) return 'Mon–Sat'
  if (d.length === 5 && has([1, 2, 3, 4, 5])) return 'Mon–Fri'
  return d.map((x) => WEEKDAYS[x]).join(', ')
}

export interface PersonRef { id: string; full_name: string }

export interface Task {
  id: string
  task_no: number
  title: string
  description: string | null
  created_by: string             // original creator (never changes)
  assigned_by: string            // who handed it to the current assignee
  assigned_to: string            // current assignee
  participants: string[]         // everyone who created / passed on / held it
  assigned_at: string            // when the current assignee received it
  reassigned: boolean            // current assignee got it via a handover
  seen_at: string | null         // when the current assignee first opened it (null = New)
  task_type: TaskType            // adhoc = one-off; recurring = one day's copy of a recurring task
  recurring_id: string | null
  occurrence_date: string | null
  due_date: string | null        // YYYY-MM-DD
  start_time: string | null      // "HH:MM:SS" on the due date, optional
  end_time: string | null
  priority: TaskPriority
  status: TaskStatus
  completed_at: string | null
  created_at: string
  updated_at: string
  assignee: PersonRef | null
  assigner: PersonRef | null
  creator: PersonRef | null
}

export interface TaskComment { id: string; task_id: string; author_id: string; body: string; created_at: string; author: PersonRef | null }
export interface TaskAttachment { id: string; task_id: string; uploaded_by: string; file_path: string; file_name: string; size_bytes: number | null; created_at: string; uploader: PersonRef | null }
export interface TaskActivity { id: number; task_id: string; actor_id: string | null; action: string; old_value: string | null; new_value: string | null; created_at: string; actor: PersonRef | null }

export const TASK_SELECT =
  '*, assignee:profiles!tasks_assigned_to_fkey(id, full_name), assigner:profiles!tasks_assigned_by_fkey(id, full_name), creator:profiles!tasks_created_by_fkey(id, full_name)'

/** "Assigned by Me": I created it or passed it on, and it's now with someone else. */
export const isGivenBy = (t: Task, userId?: string) =>
  !!userId && t.assigned_to !== userId && (t.participants ?? []).includes(userId)

/** Unopened by me, and currently with me. */
export const isNewFor = (t: Task, userId?: string) => !!userId && t.assigned_to === userId && !t.seen_at

/** Who may pass a task on: current assignee, whoever assigned it to them, the creator, or an admin. */
export const canReassign = (t: Task, userId?: string, isAdmin?: boolean) =>
  !!userId && (isAdmin || [t.assigned_to, t.assigned_by, t.created_by].includes(userId))

export async function fetchTasks(): Promise<Task[]> {
  const { data, error } = await supabase.from('tasks').select(TASK_SELECT)
    .order('due_date', { ascending: true, nullsFirst: false }).order('task_no', { ascending: false }).limit(2000)
  if (error) throw new Error(error.message)
  return (data ?? []) as Task[]
}

/** Local calendar date as YYYY-MM-DD (not UTC). */
export function todayStr(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
export function addDays(date: string, days: number) {
  const d = new Date(date + 'T00:00:00'); d.setDate(d.getDate() + days); return todayStr(d)
}

/** Current local time as "HH:MM:SS" (same format as the task's start/end time). */
function nowTimeStr(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * Not done and past its deadline (shown as the "Expired" tag).
 * The deadline is the task's end time on its due date; without an end time,
 * the whole due date counts (it expires once that day is over).
 */
export const isOverdue = (t: Pick<Task, 'due_date' | 'status'> & { end_time?: string | null }) => {
  if (t.status === 'done' || !t.due_date) return false
  const today = todayStr()
  if (t.due_date < today) return true
  if (t.due_date > today || !t.end_time) return false
  const end = t.end_time.length === 5 ? `${t.end_time}:00` : t.end_time.slice(0, 8)
  return end <= nowTimeStr()
}

export const dueTag = (t: Pick<Task, 'due_date' | 'status'> & { end_time?: string | null }): DueTag =>
  t.status === 'done' ? 'completed' : isOverdue(t) ? 'expired' : 'ongoing'

export const taskCode = (n: number) => `TM-${n}`

/** "13:00:00" -> "1:00 pm" */
export function formatTime(t: string | null) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const suffix = h >= 12 ? 'pm' : 'am'
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`
}

/** "1:00 – 2:30 pm" (or "" when no time is set). */
export function formatTimeRange(start: string | null, end: string | null) {
  if (!start || !end) return ''
  const a = formatTime(start), b = formatTime(end)
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`
}

/** Minutes between two "HH:MM" times, as "1h 30m". */
export function timeLength(start: string, end: string) {
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
  const d = toMin(end) - toMin(start)
  if (d <= 0) return ''
  const h = Math.floor(d / 60), m = d % 60
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`
}

/** The assignee plans the time; the creator and admins can set it too. */
export const canSetTime = (t: Task, userId?: string, isAdmin?: boolean) =>
  !!userId && (isAdmin || t.assigned_to === userId || t.created_by === userId)

export function formatDate(d: string | null) {
  if (!d) return '—'
  const [y, m, day] = d.slice(0, 10).split('-')
  return `${day}-${m}-${y}`
}

export function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m} minute${m > 1 ? 's' : ''} ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`
  const d = Math.floor(h / 24); if (d < 7) return `${d} day${d > 1 ? 's' : ''} ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024

/** Uploads one file to the task-files bucket and records it. */
export async function uploadAttachment(taskId: string, userId: string, file: File) {
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is larger than 10 MB`)
  const safe = file.name.replace(/[^\w.\-]+/g, '_')
  const path = `${taskId}/${crypto.randomUUID()}-${safe}`
  const up = await supabase.storage.from('task-files').upload(path, file, { contentType: file.type || undefined })
  if (up.error) throw new Error(up.error.message)
  const { error } = await supabase.from('task_attachments').insert({
    task_id: taskId, uploaded_by: userId, file_path: path, file_name: file.name, size_bytes: file.size,
  })
  if (error) {
    await supabase.storage.from('task-files').remove([path])
    throw new Error(error.message)
  }
}

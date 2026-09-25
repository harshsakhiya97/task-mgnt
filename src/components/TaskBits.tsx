import { DUE_TAG_LABELS, dueTag, PRIORITY_LABELS, STATUS_LABELS, type Task, type TaskPriority, type TaskStatus, type TaskType } from '../lib/tasks'

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return <span className={`badge pr-${priority}`}>{PRIORITY_LABELS[priority]}</span>
}

/** Ongoing / Expired / Completed, worked out from the due date and status. */
export function DueTagBadge({ task }: { task: Pick<Task, 'status' | 'due_date'> }) {
  const tag = dueTag(task)
  return <span className={`badge due-${tag}`}>{DUE_TAG_LABELS[tag]}</span>
}

export function TypeChip({ type }: { type: TaskType }) {
  return type === 'recurring' ? <span className="type-chip">↻ Recurring</span> : null
}

/** Pill-shaped status dropdown, coloured by status (like the CRM's lead-status pill). */
export function StatusSelect({ value, onChange, disabled }: { value: TaskStatus; onChange: (s: TaskStatus) => void; disabled?: boolean }) {
  return (
    <select className={`status-select st-${value}`} value={value} disabled={disabled}
      onClick={(e) => e.stopPropagation()} onChange={(e) => onChange(e.target.value as TaskStatus)}>
      {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  )
}

import { Copy, Eye, Trash2 } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { formatDate, formatTimeRange, isNewFor, isOverdue, taskCode, timeAgo, type Task, type TaskStatus } from '../lib/tasks'
import { DueTagBadge, PriorityBadge, StatusSelect, TypeChip } from './TaskBits'
import { AssigneeName } from './AssigneeName'

export type PersonColumn = 'assignee' | 'assigner' | 'both'

export function TaskTable({ tasks, offset = 0, person, onOpen, onStatus, onDelete, onCopy }: {
  tasks: Task[]
  offset?: number
  person: PersonColumn
  onOpen: (t: Task) => void
  onStatus: (t: Task, s: TaskStatus) => void
  /** Shown only for tasks the user may delete (the creator or an admin). */
  onDelete?: (t: Task) => void
  /** Opens Add Task prefilled with this task. */
  onCopy?: (t: Task) => void
}) {
  const { profile } = useAuth()
  const canDelete = (t: Task) => !!onDelete && (t.created_by === profile?.id || profile?.role === 'admin')
  return (
    <table className="task-table">
      <thead>
        <tr>
          <th>Sr. No.</th><th>Task No.</th><th>Title</th>
          {person !== 'assigner' && <th>Assigned To</th>}
          {person !== 'assignee' && <th>Assigned By</th>}
          <th>Due Date</th><th>Priority</th><th>Status</th><th></th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((t, i) => (
          <tr key={t.id} className={`clickable ${isNewFor(t, profile?.id) ? 'is-new' : ''}`} onClick={() => onOpen(t)}>
            <td className="c-sr">{offset + i + 1}</td>
            <td className="task-no">{taskCode(t.task_no)}</td>
            <td className="c-title">
              <div className="task-title" title={t.title}>
                {isNewFor(t, profile?.id) && <span className="new-badge">New</span>}
                {t.title}
                <TypeChip task={t} />
              </div>
              {t.reassigned && t.assigned_to === profile?.id && t.assigner && (
                <div className="reassigned-tag">↪ Reassigned by {t.assigner.full_name} · {timeAgo(t.assigned_at)}</div>
              )}
            </td>
            {person !== 'assigner' && <td className="c-to" data-label="To"><AssigneeName task={t} /></td>}
            {person !== 'assignee' && <td className="c-by" data-label="By">{t.assigner?.full_name ?? '—'}</td>}
            <td className="c-due">
              <div className="due-cell">
                <span className={isOverdue(t) ? 'overdue-text' : ''}>{formatDate(t.due_date)}</span>
                {t.start_time && <span className="time-text">{formatTimeRange(t.start_time, t.end_time)}</span>}
                <DueTagBadge task={t} />
              </div>
            </td>
            <td className="c-pri"><PriorityBadge priority={t.priority} /></td>
            <td className="c-status" onClick={(e) => e.stopPropagation()}><StatusSelect value={t.status} onChange={(s) => onStatus(t, s)} /></td>
            <td className="actions">
              <button className="icon" title="View" onClick={(e) => { e.stopPropagation(); onOpen(t) }}><Eye size={17} /></button>
              {onCopy && <button className="icon" title="Copy (new task with the same details)" onClick={(e) => { e.stopPropagation(); onCopy(t) }}><Copy size={16} /></button>}
              {canDelete(t) && (
                <button className="icon danger" title="Delete" onClick={(e) => { e.stopPropagation(); onDelete!(t) }}><Trash2 size={17} /></button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

import { Eye, Trash2 } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { formatDate, formatTimeRange, isNewFor, isOverdue, taskCode, timeAgo, type Task, type TaskStatus } from '../lib/tasks'
import { DueTagBadge, PriorityBadge, StatusSelect, TypeChip } from './TaskBits'

export type PersonColumn = 'assignee' | 'assigner' | 'both'

export function TaskTable({ tasks, offset = 0, person, onOpen, onStatus, onDelete }: {
  tasks: Task[]
  offset?: number
  person: PersonColumn
  onOpen: (t: Task) => void
  onStatus: (t: Task, s: TaskStatus) => void
  /** Shown only for tasks the user may delete (the creator or an admin). */
  onDelete?: (t: Task) => void
}) {
  const { profile } = useAuth()
  const canDelete = (t: Task) => !!onDelete && (t.created_by === profile?.id || profile?.role === 'admin')
  return (
    <table>
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
            <td>{offset + i + 1}</td>
            <td className="task-no">{taskCode(t.task_no)}</td>
            <td>
              <div className="task-title" title={t.title}>
                {isNewFor(t, profile?.id) && <span className="new-badge">New</span>}
                {t.title}
                <TypeChip type={t.task_type} />
              </div>
              {t.reassigned && t.assigned_to === profile?.id && t.assigner && (
                <div className="reassigned-tag">↪ Reassigned by {t.assigner.full_name} · {timeAgo(t.assigned_at)}</div>
              )}
            </td>
            {person !== 'assigner' && <td>{t.assignee?.full_name ?? '—'}</td>}
            {person !== 'assignee' && <td>{t.assigner?.full_name ?? '—'}</td>}
            <td>
              <div className="due-cell">
                <span className={isOverdue(t) ? 'overdue-text' : ''}>{formatDate(t.due_date)}</span>
                {t.start_time && <span className="time-text">{formatTimeRange(t.start_time, t.end_time)}</span>}
                <DueTagBadge task={t} />
              </div>
            </td>
            <td><PriorityBadge priority={t.priority} /></td>
            <td><StatusSelect value={t.status} onChange={(s) => onStatus(t, s)} /></td>
            <td className="actions">
              <button className="icon" title="View" onClick={(e) => { e.stopPropagation(); onOpen(t) }}><Eye size={17} /></button>
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

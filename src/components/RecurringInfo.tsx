import { useState } from 'react'
import { Pause, Pencil, Play, Trash2 } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { formatDate, formatTimeRange, weekdayNames, type RecurringTask } from '../lib/tasks'
import type { Profile } from '../lib/types'
import { ConfirmDialog } from './ConfirmDialog'
import { Drawer } from './Drawer'
import { RecurringForm } from './RecurringForm'
import { PriorityBadge } from './TaskBits'

/** Details of a recurring task, opened from a future ("scheduled") day on the calendar. */
export function RecurringInfo({ item, date, users, fromTask, onClose, onSaved }: {
  item: RecurringTask; date: string; users: Profile[]; fromTask?: boolean; onClose: () => void; onSaved: () => void
}) {
  const { profile } = useAuth()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const canManage = profile?.role === 'admin' || item.created_by === profile?.id

  const togglePause = async () => {
    setBusy(true)
    const { error } = await supabase.from('recurring_tasks').update({ is_active: !item.is_active }).eq('id', item.id)
    setBusy(false)
    if (error) setError(error.message); else onSaved()
  }

  const remove = async () => {
    setBusy(true)
    const { error } = await supabase.from('recurring_tasks').delete().eq('id', item.id)
    setBusy(false)
    setConfirmDelete(false)
    if (error) setError(error.message); else onSaved()
  }

  if (editing) {
    return <RecurringForm item={item} users={users} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onSaved() }} />
  }

  return (
    <>
      <Drawer title="↻ Recurring task" onClose={onClose} hideSubmit>
        <div className="hint-box">
          {fromTask
            ? <>This is the schedule behind the task for <b>{formatDate(date)}</b>. A new copy is created on each chosen day just after midnight.</>
            : <>Scheduled for <b>{formatDate(date)}</b>. The task for this day is created automatically just after midnight,
              and then it can be updated like any other task.</>}
        </div>
        <dl className="detail-grid">
          <dt>Title</dt><dd>{item.title}</dd>
          <dt>Assigned To</dt><dd>{item.assignee?.full_name ?? '—'}</dd>
          <dt>Repeats</dt><dd>{weekdayNames(item.weekdays)}</dd>
          <dt>Time</dt><dd>{item.start_time ? formatTimeRange(item.start_time, item.end_time) : <span className="muted">No time (shown in the Due row)</span>}</dd>
          <dt>From</dt><dd>{formatDate(item.start_date)}</dd>
          <dt>Until</dt><dd>{item.end_date ? formatDate(item.end_date) : 'Until stopped'}</dd>
          <dt>Priority</dt><dd><PriorityBadge priority={item.priority} /></dd>
          <dt>Created By</dt><dd>{item.creator?.full_name ?? '—'}</dd>
        </dl>
        {item.description && <><div className="form-section">Description</div><div className="desc">{item.description}</div></>}
        {error && <div className="alert error" style={{ marginTop: 14 }}>{error}</div>}
        {canManage && (
          <div className="head-actions" style={{ marginTop: 16, flexWrap: 'wrap' }}>
            <button type="button" className="secondary" onClick={() => setEditing(true)}><Pencil size={15} /> Edit schedule</button>
            <button type="button" className="secondary" disabled={busy} onClick={togglePause}>
              {item.is_active ? <><Pause size={15} /> Pause</> : <><Play size={15} /> Resume</>}
            </button>
            <button type="button" className="danger-outline" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Delete recurring task</button>
          </div>
        )}
      </Drawer>
      {confirmDelete && (
        <ConfirmDialog icon={<Trash2 size={30} />} title={`Delete "${item.title}"?`}
          message="All future scheduled days will be removed. Tasks already created (today and earlier) stay in the task list."
          confirmLabel="Yes, Delete" busy={busy} onConfirm={remove} onCancel={() => setConfirmDelete(false)} />
      )}
    </>
  )
}

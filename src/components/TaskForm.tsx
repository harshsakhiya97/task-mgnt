import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { todayStr, uploadAttachment, PRIORITY_LABELS, type Task, type TaskPriority, type TaskType } from '../lib/tasks'
import type { Profile } from '../lib/types'
import { Drawer } from './Drawer'
import { Field } from './Fields'
import { FilePicker } from './FilePicker'
import { WeekdayPicker } from './WeekdayPicker'
import { fromDbTime, TimeRangeInput, timePairError, toDbTime } from './TimeRangeInput'

export type TaskSaved = { taskId?: string; recurring?: boolean }

/** Create a new task (ad hoc or recurring), or edit the details of an existing one (creator/admin only). */
export function TaskForm({ task, users, initial, onClose, onSaved }: {
  task?: Task
  users: Profile[]
  /** Prefill for a new task, e.g. from a slot picked on the calendar. */
  initial?: { dueDate?: string; from?: string; to?: string; assignTo?: string }
  onClose: () => void
  onSaved: (r: TaskSaved) => void
}) {
  const { profile } = useAuth()
  const [type, setType] = useState<TaskType>(task?.task_type ?? 'adhoc')
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [assignedTo, setAssignedTo] = useState(task?.assigned_to ?? initial?.assignTo ?? profile?.id ?? '')
  const [dueDate, setDueDate] = useState(task ? task.due_date ?? '' : initial?.dueDate ?? todayStr())
  const [from, setFrom] = useState(task ? fromDbTime(task.start_time) : initial?.from ?? '')
  const [to, setTo] = useState(task ? fromDbTime(task.end_time) : initial?.to ?? '')
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'medium')
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6])
  const [startDate, setStartDate] = useState(todayStr())
  const [endDate, setEndDate] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const creatingRecurring = !task && type === 'recurring'

  const submit = async () => {
    if (!profile) return
    setError('')
    if (creatingRecurring && weekdays.length === 0) return setError('Pick at least one day')
    if (!creatingRecurring && task?.task_type !== 'recurring' && !dueDate) return setError('Ad hoc tasks need a due date')
    const timeErr = timePairError(from, to)
    if (timeErr) return setError(timeErr)
    setBusy(true)
    try {
      if (creatingRecurring) {
        const { error } = await supabase.from('recurring_tasks').insert({
          title: title.trim(), description: description.trim() || null, priority, assigned_to: assignedTo,
          created_by: profile.id, weekdays, start_date: startDate, end_date: endDate || null,
          start_time: toDbTime(from), end_time: toDbTime(to),
        })
        if (error) throw new Error(error.message)
        return onSaved({ recurring: true })
      }
      const fields = {
        title: title.trim(), description: description.trim() || null, assigned_to: assignedTo,
        due_date: dueDate || null, priority, start_time: toDbTime(from), end_time: toDbTime(to),
      }
      let id = task?.id
      if (task) {
        const { error } = await supabase.from('tasks').update(fields).eq('id', task.id)
        if (error) throw new Error(error.message)
      } else {
        const { data, error } = await supabase.from('tasks').insert({ ...fields, task_type: 'adhoc', assigned_by: profile.id }).select('id').single()
        if (error) throw new Error(error.message)
        id = data.id as string
      }
      for (const f of files) await uploadAttachment(id!, profile.id, f)
      onSaved({ taskId: id })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // Keep the current assignee selectable even if they were deactivated later.
  const options = task && !users.some((u) => u.id === task.assigned_to) && task.assignee
    ? [...users, { id: task.assigned_to, full_name: `${task.assignee.full_name} (inactive)` } as Profile]
    : users

  return (
    <Drawer title={task ? 'Edit Task' : 'Add Task'} onClose={onClose} onSubmit={submit}
      submitLabel={task ? 'Update' : creatingRecurring ? 'Create Recurring Task' : 'Create Task'} busy={busy}>
      {!task && (
        <div className="segmented" role="tablist" aria-label="Task type">
          <button type="button" role="tab" aria-selected={type === 'adhoc'} className={type === 'adhoc' ? 'on' : ''} onClick={() => setType('adhoc')}>Ad hoc (one-time)</button>
          <button type="button" role="tab" aria-selected={type === 'recurring'} className={type === 'recurring' ? 'on' : ''} onClick={() => setType('recurring')}>↻ Recurring</button>
        </div>
      )}
      {task?.task_type === 'recurring' && (
        <div className="hint-box">This is one day's copy of a recurring task. Changes here affect only this day. To change the schedule, edit it under <b>Tasks → Recurring</b>.</div>
      )}
      <div className="form-section">Task Details</div>
      <Field label="Title" required>
        <input required autoFocus placeholder="What needs to be done?" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Description">
        <textarea rows={4} placeholder="Add details, links or instructions" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="form-section">Assignment</div>
      <div className="form-grid">
        <Field label="Assign To" required>
          <select required value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            {options.map((u) => <option key={u.id} value={u.id}>{u.full_name}{u.id === profile?.id ? ' (me)' : ''}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        {!creatingRecurring && (
          <Field label="Due Date" required={task?.task_type !== 'recurring'}>
            <input type="date" required={task?.task_type !== 'recurring'} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        )}
      </div>
      <TimeRangeInput from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }}
        label={creatingRecurring ? 'Time (optional, each day)' : 'Time (optional)'}
        hint={creatingRecurring ? 'e.g. 10:00 – 11:00 am. Each day\'s copy gets this time.' : 'Shows the task at this time on the calendar.'} />
      {creatingRecurring && (
        <>
          <div className="form-section">Schedule</div>
          <Field label="Repeat On" required hint="A copy of the task is created for the assignee on each chosen day, due the same day.">
            <WeekdayPicker value={weekdays} onChange={setWeekdays} />
          </Field>
          <div className="form-grid">
            <Field label="Start Date" required>
              <input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="End Date" hint="Leave empty to repeat until stopped.">
              <input type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>
        </>
      )}
      {!task && !creatingRecurring && (
        <>
          <div className="form-section">Attachments</div>
          <FilePicker files={files} onChange={setFiles} onError={setError} />
        </>
      )}
      {error && <div className="alert error" style={{ marginTop: 14 }}>{error}</div>}
    </Drawer>
  )
}

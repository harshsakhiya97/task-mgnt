import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { PRIORITY_LABELS, type RecurringTask, type TaskPriority } from '../lib/tasks'
import type { Profile } from '../lib/types'
import { Drawer } from './Drawer'
import { Field } from './Fields'
import { WeekdayPicker } from './WeekdayPicker'
import { fromDbTime, TimeRangeInput, timePairError, toDbTime } from './TimeRangeInput'

/** Edit a recurring task's schedule. Changes apply to copies created from now on. */
export function RecurringForm({ item, users, onClose, onSaved }: {
  item: RecurringTask; users: Profile[]; onClose: () => void; onSaved: () => void
}) {
  const [title, setTitle] = useState(item.title)
  const [description, setDescription] = useState(item.description ?? '')
  const [assignedTo, setAssignedTo] = useState(item.assigned_to)
  const [priority, setPriority] = useState<TaskPriority>(item.priority)
  const [weekdays, setWeekdays] = useState<number[]>(item.weekdays)
  const [startDate, setStartDate] = useState(item.start_date)
  const [endDate, setEndDate] = useState(item.end_date ?? '')
  const [from, setFrom] = useState(fromDbTime(item.start_time))
  const [to, setTo] = useState(fromDbTime(item.end_time))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setError('')
    if (weekdays.length === 0) return setError('Pick at least one day')
    const timeErr = timePairError(from, to)
    if (timeErr) return setError(timeErr)
    setBusy(true)
    const { error } = await supabase.from('recurring_tasks').update({
      title: title.trim(), description: description.trim() || null, assigned_to: assignedTo, priority,
      weekdays, start_date: startDate, end_date: endDate || null,
      start_time: toDbTime(from), end_time: toDbTime(to),
    }).eq('id', item.id)
    setBusy(false)
    if (error) return setError(error.message)
    onSaved()
  }

  return (
    <Drawer title="Edit Recurring Task" onClose={onClose} onSubmit={submit} submitLabel="Update" busy={busy}>
      <div className="hint-box">Changes apply to copies created from now on. Copies already created (including today's) stay as they are.</div>
      <Field label="Title" required><input required value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Description"><textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div className="form-grid">
        <Field label="Assign To" required>
          <select required value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Repeat On" required><WeekdayPicker value={weekdays} onChange={setWeekdays} /></Field>
      <TimeRangeInput from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }} label="Time (optional, each day)" />
      <div className="form-grid">
        <Field label="Start Date" required><input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
        <Field label="End Date" hint="Empty = until stopped"><input type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
      </div>
      {error && <div className="alert error">{error}</div>}
    </Drawer>
  )
}

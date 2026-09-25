import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { formatDate, formatTimeRange, taskCode, type Task } from '../lib/tasks'
import { Drawer } from './Drawer'
import { Field } from './Fields'
import { TimeRangeInput, timePairError, toDbTime } from './TimeRangeInput'

/** A slot was picked on the calendar: put one of my tasks due that day there, or create a new task at that time. */
export function ScheduleForm({ date, from, to, myTasks, onNewTask, onClose, onSaved }: {
  date: string; from: string; to: string; myTasks: Task[]
  onNewTask: (p: { dueDate: string; from: string; to: string }) => void
  onClose: () => void; onSaved: () => void
}) {
  const { profile } = useAuth()
  const [f, setF] = useState(from)
  const [t, setT] = useState(to)
  const options = useMemo(() => myTasks
    .filter((x) => x.status !== 'done' && x.due_date === date)
    .sort((a, b) => Number(!!a.start_time) - Number(!!b.start_time)), [myTasks, date])
  const [taskId, setTaskId] = useState(options[0]?.id ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const err = timePairError(f, t)
    if (err) return setError(err)
    if (!taskId) return setError('Choose a task, or create a new one')
    setBusy(true)
    const { error } = await supabase.from('tasks').update({ start_time: toDbTime(f), end_time: toDbTime(t) }).eq('id', taskId)
    setBusy(false)
    if (error) return setError(error.message)
    onSaved()
  }

  return (
    <Drawer title={`Schedule · ${formatDate(date)}`} onClose={onClose} onSubmit={submit} submitLabel="Set Time" busy={busy} hideSubmit={!options.length}>
      <TimeRangeInput from={f} to={t} onChange={(a, b) => { setF(a); setT(b) }} label="Time" />
      {options.length ? (
        <Field label="Task due this day" required hint="Tasks without a time are listed first.">
          <select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            {options.map((x) => (
              <option key={x.id} value={x.id}>
                {taskCode(x.task_no)} · {x.title}{x.start_time ? ` (now ${formatTimeRange(x.start_time, x.end_time)})` : ''}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <p className="muted">You have no open tasks due on {formatDate(date)}.</p>
      )}
      <div className="hint-box">
        Want to add something new at this time?
        <div style={{ marginTop: 8 }}>
          <button type="button" className="secondary" onClick={() => onNewTask({ dueDate: date, from: f, to: t })} disabled={!profile}>
            <Plus size={16} /> Create a new task at this time
          </button>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
    </Drawer>
  )
}

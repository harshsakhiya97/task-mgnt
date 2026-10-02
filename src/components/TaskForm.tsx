import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { todayStr, uploadAttachment, PRIORITY_LABELS, type Task, type TaskPriority, type TaskType } from '../lib/tasks'
import type { Profile } from '../lib/types'
import { Drawer } from './Drawer'
import { Field } from './Fields'
import { FilePicker } from './FilePicker'
import { WeekdayPicker } from './WeekdayPicker'
import { fromDbTime, TimeRangeInput, timePairError, toDbTime } from './TimeRangeInput'
import { AutoReminderNote, autoDrafts, DraftReminderList, dropAutoReminders, saveDraftReminders, TaskReminders, type AutoKey, type AutoPreview, type DraftReminder } from './Reminders'
import { loadReminderRules, type ReminderRule } from '../lib/reminders'

type Mode = TaskType | 'reel'

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
  const [mode, setMode] = useState<Mode>(task ? (task.kind === 'reel' ? 'reel' : task.task_type) : 'adhoc')
  const type: TaskType = mode === 'recurring' ? 'recurring' : 'adhoc'
  const isReel = mode === 'reel'
  // Reel details (2.0): caption, expected views, expected edit time.
  const [caption, setCaption] = useState(task?.reel?.caption ?? '')
  const [expViews, setExpViews] = useState(task?.reel?.expected_views != null ? String(task.reel.expected_views) : '')
  const [expH, setExpH] = useState(task?.reel?.expected_minutes ? String(Math.floor(task.reel.expected_minutes / 60)) : '')
  const [expM, setExpM] = useState(task?.reel?.expected_minutes ? String(task.reel.expected_minutes % 60) : '')
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  // An unassigned task (e.g. from Perisclaw) stays unassigned until someone is picked.
  const [assignedTo, setAssignedTo] = useState(task ? task.assigned_to ?? '' : initial?.assignTo ?? profile?.id ?? '')
  const wasUnassigned = !!task && !task.assigned_to
  const [dueDate, setDueDate] = useState(task ? task.due_date ?? '' : initial?.dueDate ?? todayStr())
  const [from, setFrom] = useState(task ? fromDbTime(task.start_time) : initial?.from ?? '')
  const [to, setTo] = useState(task ? fromDbTime(task.end_time) : initial?.to ?? '')
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'medium')
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6])
  const [startDate, setStartDate] = useState(todayStr())
  const [endDate, setEndDate] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [reminders, setReminders] = useState<DraftReminder[]>([])
  // Automatic reminders (Settings → Reminders) are shown as rows in the form; the ones taken out are removed after saving.
  const [rules, setRules] = useState<ReminderRule[]>([])
  const [removedAuto, setRemovedAuto] = useState<AutoKey[]>([])
  useEffect(() => { loadReminderRules(true).then(setRules) }, [])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const creatingRecurring = !task && type === 'recurring'
  const assigneeIsMe = assignedTo === profile?.id
  const autoAll = !task && !creatingRecurring && dueDate ? autoDrafts(rules.find((r) => r.priority === priority), assigneeIsMe) : []
  const autoShown = autoAll.filter((d) => !removedAuto.includes(d.key))
  // Editing with a different priority: show the Auto reminders the task will get on Update (the database swaps them).
  const priorityChanged = !!task && task.task_type !== 'recurring' && priority !== task.priority
  const editAssigner = task?.assigned_by
  const editAuto = priorityChanged && dueDate
    ? autoDrafts(rules.find((r) => r.priority === priority), (assignedTo || null) === editAssigner) : []
  const nameOf = (id?: string | null) => id === profile?.id ? 'Remind me' : `Remind ${users.find((u) => u.id === id)?.full_name ?? (id === task?.assigned_to ? task?.assignee?.full_name : task?.assigner?.full_name) ?? 'someone'}`
  const preview: AutoPreview | undefined = priorityChanged ? {
    rows: editAuto.filter((d) => !removedAuto.includes(d.key))
      .map((d) => ({ ...d, label: nameOf(d.key === 'assignee' ? assignedTo || null : editAssigner) })),
    onRemove: (k) => setRemovedAuto((r) => [...r, k]),
  } : undefined

  const submit = async () => {
    if (!profile) return
    setError('')
    if (creatingRecurring && weekdays.length === 0) return setError('Pick at least one day')
    if (!creatingRecurring && task?.task_type !== 'recurring' && !dueDate) return setError('Ad hoc tasks need a due date')
    const timeErr = timePairError(from, to)
    if (timeErr) return setError(timeErr)
    const expMinutes = (Number(expH) || 0) * 60 + (Number(expM) || 0)
    if (isReel && (Number(expH) < 0 || Number(expM) < 0 || Number(expViews) < 0)) return setError('Expected views and time can\'t be negative')
    const reelFields = { caption: caption.trim() || null, expected_views: expViews === '' ? null : Math.round(Number(expViews)), expected_minutes: expMinutes || null }
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
        title: title.trim(), description: description.trim() || null, assigned_to: assignedTo || null,
        due_date: dueDate || null, priority, start_time: toDbTime(from), end_time: toDbTime(to),
      }
      let id = task?.id
      if (task) {
        const { error } = await supabase.from('tasks').update(fields).eq('id', task.id)
        if (error) throw new Error(error.message)
        // Auto reminders taken out in the form (the database just added them for the new priority).
        const dropped = editAuto.filter((d) => removedAuto.includes(d.key)).map((d) => d.key)
        const err = dropped.length ? await dropAutoReminders(task.id, task.assigned_by, dropped) : null
        if (err) throw new Error(`Task updated, but a reminder couldn't be removed: ${err}`)
      } else {
        const { data, error } = await supabase.from('tasks')
          .insert({ ...fields, task_type: 'adhoc', kind: isReel ? 'reel' : 'task', assigned_by: profile.id }).select('id').single()
        if (error) throw new Error(error.message)
        id = data.id as string
      }
      if (isReel) {
        // The reel's details row is made with the task; fill it in (only what changed when editing).
        const r = task?.reel
        const changed = !r || r.caption !== reelFields.caption || r.expected_views !== reelFields.expected_views || r.expected_minutes !== reelFields.expected_minutes
        if (changed) {
          const { error } = await supabase.from('task_reels').update(reelFields).eq('task_id', id!)
          if (error) throw new Error(`${task ? 'Task updated' : 'Reel created'}, but its details couldn't be saved: ${error.message}`)
        }
      }
      for (const f of files) await uploadAttachment(id!, profile.id, f)
      if (!task) {
        const err = await saveDraftReminders(id!, profile.id, reminders)
          ?? await dropAutoReminders(id!, profile.id, autoAll.filter((d) => removedAuto.includes(d.key)).map((d) => d.key))
        if (err) throw new Error(`Task created, but a reminder couldn't be saved: ${err}`)
      }
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
      submitLabel={task ? 'Update' : creatingRecurring ? 'Create Recurring Task' : isReel ? 'Create Reel' : 'Create Task'} busy={busy}>
      {!task && (
        <div className="segmented type-picker" role="tablist" aria-label="Task type">
          {([['adhoc', 'One-time'], ['recurring', '↻ Recurring'], ['reel', '🎬 Reel']] as [Mode, string][]).map(([m, l]) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{l}</button>
          ))}
        </div>
      )}
      {task?.task_type === 'recurring' && (
        <div className="hint-box">This is one day's copy of a recurring task. Changes here affect only this day. To change the schedule, edit it under <b>Tasks → Recurring</b>.</div>
      )}
      <div className="form-section">{isReel ? 'Reel Details' : 'Task Details'}</div>
      <Field label={isReel ? 'Video Title' : 'Title'} required>
        <input required autoFocus placeholder={isReel ? 'e.g. 5 tips for Class 10 boards' : 'What needs to be done?'} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label={isReel ? 'Brief / Instructions' : 'Description'}>
        <textarea rows={isReel ? 3 : 4} placeholder={isReel ? 'Raw footage link, style, music, what to cut…' : 'Add details, links or instructions'} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      {isReel && (
        <>
          <Field label="Caption" hint="The editor can change it later in the reel's details.">
            <textarea rows={3} placeholder="Caption for the post (optional)" value={caption} onChange={(e) => setCaption(e.target.value)} />
          </Field>
          <div className="form-grid">
            <Field label="Expected Views" hint="Views you expect 24 hours after posting.">
              <input type="number" inputMode="numeric" min={0} step={100} placeholder="e.g. 10000" value={expViews} onChange={(e) => setExpViews(e.target.value)} />
            </Field>
            <Field label="Expected Edit Time" hint="How long the edit should take.">
              <div className="duration-input">
                <input type="number" inputMode="numeric" min={0} max={168} placeholder="0" value={expH} onChange={(e) => setExpH(e.target.value)} aria-label="Hours" /><span>h</span>
                <input type="number" inputMode="numeric" min={0} max={59} step={5} placeholder="0" value={expM} onChange={(e) => setExpM(e.target.value)} aria-label="Minutes" /><span>m</span>
              </div>
            </Field>
          </div>
        </>
      )}
      <div className="form-section">Assignment</div>
      <div className="form-grid">
        <Field label="Assign To" required={!wasUnassigned}>
          <select required={!wasUnassigned} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            {wasUnassigned && <option value="">Unassigned (pick a person)</option>}
            {options.map((u) => <option key={u.id} value={u.id}>{u.full_name}{u.id === profile?.id ? ' (me)' : ''}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select value={priority} onChange={(e) => { setPriority(e.target.value as TaskPriority); setRemovedAuto([]) }}>
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
      {task && task.task_type !== 'recurring' && (
        // Editing: the task's reminders, added / removed straight away (same as in its details).
        <>
          <TaskReminders task={task} onError={setError} preview={preview} />
        </>
      )}
      {!creatingRecurring && !task && (
        <>
          <div className="form-section">Reminders</div>
          <AutoReminderNote priority={priority} prefilled />
          <DraftReminderList drafts={reminders} onChange={setReminders} canRemindAssignee
            assigneeIsMe={assigneeIsMe} assigneeName={users.find((u) => u.id === assignedTo)?.full_name} hasDue={!!dueDate} hasStart={!!from}
            auto={autoShown} onRemoveAuto={(k) => setRemovedAuto((r) => [...r, k])} />
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

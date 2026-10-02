import { useState } from 'react'
import { AlarmClock, Clock, FileText, MessageSquareText, Paperclip, Plus } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { taskCode, todayStr, uploadAttachment, PRIORITY_LABELS, type Task, type TaskPriority, type TaskType } from '../lib/tasks'
import type { Profile } from '../lib/types'
import { Drawer } from './Drawer'
import { REEL_SUB_TYPES } from '../lib/reels'
import { Field } from './Fields'
import { FilePicker } from './FilePicker'
import { WeekdayPicker } from './WeekdayPicker'
import { fromDbTime, TimeRangeInput, timePairError, toDbTime } from './TimeRangeInput'
import { DraftReminderList, saveDraftReminders, TaskReminders, type DraftReminder } from './Reminders'
import { AttendeePicker } from './AttendeePicker'
import { MEETING_REMIND_OPTIONS } from '../lib/meetings'

type Mode = TaskType | 'reel' | 'meeting'
/** Optional parts of the form, opened with "+ …" buttons so the form starts short. */
type Extra = 'desc' | 'caption' | 'time' | 'reminders' | 'files'

export type TaskSaved = { taskId?: string; recurring?: boolean }

/** Create a new task (ad hoc or recurring), or edit the details of an existing one (creator/admin only). */
export function TaskForm({ task, copyFrom, actionFor, users, initial, onClose, onSaved }: {
  task?: Task
  /** "Copy": a new task prefilled with this task's details. */
  copyFrom?: Task
  /** "Add action item": a new one-time task linked to this meeting. */
  actionFor?: Task
  users: Profile[]
  /** Prefill for a new task, e.g. from a slot picked on the calendar. */
  initial?: { dueDate?: string; from?: string; to?: string; assignTo?: string }
  onClose: () => void
  onSaved: (r: TaskSaved) => void
}) {
  const { profile } = useAuth()
  // Prefill from the task being edited, or from the one being copied (a copy is always a new one-time task / reel).
  const src = task ?? copyFrom
  const [mode, setMode] = useState<Mode>(task ? (task.kind === 'reel' || task.kind === 'meeting' ? task.kind : task.task_type)
    : copyFrom?.kind === 'reel' || copyFrom?.kind === 'meeting' ? copyFrom.kind : 'adhoc')
  const type: TaskType = mode === 'recurring' ? 'recurring' : 'adhoc'
  const isReel = mode === 'reel'
  const isMeeting = mode === 'meeting'
  // Meeting (2.2): attendees, link, "remind everyone". The organiser is whoever creates it.
  const [attendees, setAttendees] = useState<string[]>((src?.attendees ?? []).map((a) => a.user_id))
  const [link, setLink] = useState(src?.meeting?.meeting_link ?? '')
  const [remind, setRemind] = useState<number | null>(src ? src.meeting?.remind_minutes ?? null : 10)
  // Reel details (2.0): caption and upload date. (Expected views / edit time are set by the editor in the reel's Reel tab.)
  const [caption, setCaption] = useState(src?.reel?.caption ?? '')
  const [uploadDate, setUploadDate] = useState(task?.reel?.upload_date ?? (copyFrom?.reel?.upload_date && copyFrom.reel.upload_date >= todayStr() ? copyFrom.reel.upload_date : ''))
  const [subType, setSubType] = useState(src?.reel?.sub_type ?? '')
  const [title, setTitle] = useState(src?.title ?? '')
  const [description, setDescription] = useState(src?.description ?? '')
  // An unassigned task (e.g. from Perisclaw) stays unassigned until someone is picked.
  const [assignedTo, setAssignedTo] = useState(task ? task.assigned_to ?? '' : copyFrom?.assigned_to ?? initial?.assignTo ?? profile?.id ?? '')
  const wasUnassigned = !!task && !task.assigned_to
  const [dueDate, setDueDate] = useState(task ? task.due_date ?? '' : copyFrom?.due_date && copyFrom.due_date >= todayStr() ? copyFrom.due_date : initial?.dueDate ?? todayStr())
  const [from, setFrom] = useState(src ? fromDbTime(src.start_time) : initial?.from ?? '')
  const [to, setTo] = useState(src ? fromDbTime(src.end_time) : initial?.to ?? '')
  const [priority, setPriority] = useState<TaskPriority>(src?.priority ?? 'medium')
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6])
  const [startDate, setStartDate] = useState(todayStr())
  const [endDate, setEndDate] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [reminders, setReminders] = useState<DraftReminder[]>([])
  // Optional sections start closed (open if editing a task that already has them).
  const [opened, setOpened] = useState<Extra[]>(() => [
    ...(src?.description ? ['desc' as const] : []),
    ...(src?.reel?.caption ? ['caption' as const] : []),
    ...(src?.start_time || initial?.from ? ['time' as const] : []),
  ])
  const open = (x: Extra) => setOpened((o) => (o.includes(x) ? o : [...o, x]))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // If the task was created but a later step failed, "Create" again finishes that task instead of adding a copy.
  const [createdId, setCreatedId] = useState<string | null>(null)
  const creatingRecurring = !task && type === 'recurring'
  const assigneeIsMe = assignedTo === profile?.id

  const submit = async () => {
    if (!profile) return
    setError('')
    if (creatingRecurring && weekdays.length === 0) return setError('Pick at least one day')
    if (!creatingRecurring && task?.task_type !== 'recurring' && !dueDate) return setError('Ad hoc tasks need a due date')
    const timeErr = timePairError(from, to)
    if (timeErr) return setError(timeErr)
    if (isMeeting && (!from || !to)) return setError('Pick the meeting\'s start and end time')
    if (isMeeting && link.trim() && !/^https?:\/\/\S+$/i.test(link.trim())) return setError('The meeting link should start with https://')
    const reelFields = { caption: caption.trim() || null, upload_date: uploadDate || null, sub_type: subType || null }
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
        title: title.trim(), description: description.trim() || null,
        // A meeting is the organiser's own (the attendees are listed separately).
        assigned_to: isMeeting ? (task ? task.assigned_to : profile.id) : assignedTo || null,
        due_date: dueDate || null, priority, start_time: toDbTime(from), end_time: toDbTime(to),
      }
      let id = task?.id
      if (task) {
        const { error } = await supabase.from('tasks').update(fields).eq('id', task.id)
        if (error) throw new Error(error.message)
      } else if (createdId) {
        const { error } = await supabase.from('tasks').update(fields).eq('id', createdId)
        if (error) throw new Error(error.message)
        id = createdId
      } else {
        const { data, error } = await supabase.from('tasks')
          .insert({ ...fields, task_type: 'adhoc', kind: isReel ? 'reel' : isMeeting ? 'meeting' : 'task', assigned_by: profile.id,
            meeting_id: actionFor?.id ?? null }).select('id').single()
        if (error) throw new Error(error.message)
        id = data.id as string
        setCreatedId(id)
      }
      if (isReel) {
        // The reel's details row is made with the task; fill it in (only what changed when editing).
        const r = task?.reel
        const changed = !r || r.caption !== reelFields.caption || (r.upload_date ?? null) !== reelFields.upload_date || (r.sub_type ?? null) !== reelFields.sub_type
        if (changed) {
          const { error } = await supabase.from('task_reels').update(reelFields).eq('task_id', id!)
          if (error) throw new Error(`${task ? 'Task updated' : 'Reel created'}, but its details couldn't be saved: ${error.message}`)
        }
      }
      if (isMeeting) {
        const m = task?.meeting
        const linkVal = link.trim() || null
        if (!m || (m.meeting_link ?? null) !== linkVal || (m.remind_minutes ?? null) !== remind) {
          const { error } = await supabase.from('task_meetings').update({ meeting_link: linkVal, remind_minutes: remind }).eq('task_id', id!)
          if (error) throw new Error(`Meeting saved, but its link / reminder couldn't be saved: ${error.message}`)
        }
        const before = (task?.attendees ?? []).map((a) => a.user_id)
        const add = attendees.filter((u) => !before.includes(u))
        const remove = before.filter((u) => !attendees.includes(u))
        if (add.length) {
          const { error } = await supabase.from('task_attendees')
            .upsert(add.map((user_id) => ({ task_id: id!, user_id })), { onConflict: 'task_id,user_id', ignoreDuplicates: true })
          if (error) throw new Error(`Meeting saved, but the attendees couldn't be invited: ${error.message}`)
        }
        if (remove.length) {
          const { error } = await supabase.from('task_attendees').delete().eq('task_id', id!).in('user_id', remove)
          if (error) throw new Error(`Meeting saved, but an attendee couldn't be removed: ${error.message}`)
        }
      }
      for (const f of files) await uploadAttachment(id!, profile.id, f)
      if (!task && !isReel && !isMeeting) {
        const err = await saveDraftReminders(id!, profile.id, reminders)
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

  const isOpen = (x: Extra) => opened.includes(x)
  const canReminders = !creatingRecurring && !isReel && !isMeeting && task?.task_type !== 'recurring' && task?.kind !== 'reel'
  const canFiles = !task && !creatingRecurring && !isReel
  const extras: { key: Extra; label: string; icon: typeof Plus; show: boolean }[] = [
    { key: 'desc', label: isReel ? 'Brief' : isMeeting ? 'Agenda' : 'Description', icon: FileText, show: true },
    { key: 'caption', label: 'Caption', icon: MessageSquareText, show: isReel },
    { key: 'time', label: 'Time', icon: Clock, show: !isMeeting },
    { key: 'reminders', label: 'Reminders', icon: AlarmClock, show: canReminders },
    { key: 'files', label: 'Attachments', icon: Paperclip, show: canFiles },
  ]
  const closedExtras = extras.filter((x) => x.show && !isOpen(x.key))

  return (
    <Drawer wide title={task ? (task.kind === 'meeting' ? 'Edit Meeting' : 'Edit Task') : copyFrom ? `Copy ${taskCode(copyFrom.task_no)}` : 'Add Task'} onClose={onClose} onSubmit={submit}
      submitLabel={task ? 'Update' : creatingRecurring ? 'Create Recurring Task' : isReel ? 'Create Reel' : isMeeting ? 'Create Meeting' : 'Create Task'} busy={busy}>
      {!task && (
        <div className="segmented type-picker" role="tablist" aria-label="Task type">
          {([['adhoc', 'One-time'], ['recurring', '↻ Recurring'], ['reel', '🎬 Reel'], ['meeting', '📅 Meeting']] as [Mode, string][]).map(([m, l]) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{l}</button>
          ))}
        </div>
      )}
      {copyFrom && (
        <div className="hint-box">A copy of <b>{taskCode(copyFrom.task_no)}</b>. Change anything you need, then create it. Comments, attachments, reminders and timer time aren't copied.</div>
      )}
      {task?.task_type === 'recurring' && (
        <div className="hint-box">This is one day's copy of a recurring task. Changes here affect only this day. To change the schedule, edit it under <b>Tasks → Recurring</b>.</div>
      )}
      <Field label={isReel ? 'Video Title' : isMeeting ? 'Meeting Title' : 'Title'} required>
        <input required autoFocus placeholder={isReel ? 'e.g. 5 tips for Class 10 boards' : isMeeting ? 'e.g. Weekly content review' : 'What needs to be done?'} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      {isReel && (
        <Field label="Sub-type">
          <select value={subType} onChange={(e) => setSubType(e.target.value)}>
            <option value="">Select…</option>
            {REEL_SUB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            {subType && !(REEL_SUB_TYPES as readonly string[]).includes(subType) && <option value={subType}>{subType}</option>}
          </select>
        </Field>
      )}
      {isMeeting && (
        <>
          <div className="form-grid">
            <Field label="Date" required>
              <input type="date" required value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
            <Field label="Remind everyone">
              <select value={remind ?? ''} onChange={(e) => setRemind(e.target.value === '' ? null : Number(e.target.value))}>
                {MEETING_REMIND_OPTIONS.map(([v, l]) => <option key={l} value={v ?? ''}>{l}</option>)}
              </select>
            </Field>
          </div>
          <TimeRangeInput from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }} label="Time *"
            hint="Shows on everyone's calendar at this time." />
          <Field label="Attendees" hint={task ? 'People you add get a notification. The organiser is always in.' : 'Everyone you add gets a notification and the meeting on their calendar. The organiser is always in.'}>
            <AttendeePicker users={users} value={attendees} onChange={setAttendees} organiserId={task?.assigned_to ?? profile?.id}
              extraNames={Object.fromEntries((src?.attendees ?? []).map((a) => [a.user_id, a.person?.full_name ?? 'Someone']))} />
          </Field>
          <Field label="Meeting Link" hint="Zoom / Google Meet link (optional).">
            <input type="url" inputMode="url" placeholder="https://zoom.us/j/…" value={link} onChange={(e) => setLink(e.target.value)} />
          </Field>
        </>
      )}
      {!isMeeting && <div className="form-grid">
        <Field label="Assign To" required={!wasUnassigned}>
          <select required={!wasUnassigned} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            {wasUnassigned && <option value="">Unassigned (pick a person)</option>}
            {options.map((u) => <option key={u.id} value={u.id}>{u.full_name}{u.id === profile?.id ? ' (me)' : ''}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        {!creatingRecurring && (
          <Field label={isReel ? 'Edit Due Date' : 'Due Date'} required={task?.task_type !== 'recurring'}>
            <input type="date" required={task?.task_type !== 'recurring'} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        )}
        {isReel && (
          <Field label="Upload Date">
            <input type="date" value={uploadDate} onChange={(e) => setUploadDate(e.target.value)} />
          </Field>
        )}
      </div>}
      {creatingRecurring && (
        <>
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

      {isOpen('desc') && (
        <Field label={isReel ? 'Brief / Instructions' : isMeeting ? 'Agenda' : 'Description'}>
          <textarea rows={4} autoFocus={!task} placeholder={isReel ? 'Raw footage link, style, music, what to cut…' : isMeeting ? 'What will you discuss?' : 'Add details, links or instructions'} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      )}
      {isReel && isOpen('caption') && (
        <Field label="Caption" hint="The editor can change it later in the reel's details.">
          <textarea rows={3} autoFocus={!task} placeholder="Caption for the post" value={caption} onChange={(e) => setCaption(e.target.value)} />
        </Field>
      )}
      {!isMeeting && isOpen('time') && (
        <TimeRangeInput from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }}
          label={creatingRecurring ? 'Time (each day)' : 'Time'}
          hint={creatingRecurring ? 'e.g. 10:00 – 11:00 am. Each day\'s copy gets this time.' : 'Shows the task at this time on the calendar.'} />
      )}
      {canReminders && isOpen('reminders') && task && (
        // Editing: the task's reminders, added / removed straight away (same as in its details).
        <TaskReminders task={task} onError={setError} />
      )}
      {canReminders && isOpen('reminders') && !task && (
        <>
          <div className="form-section">Reminders</div>
          <DraftReminderList drafts={reminders} onChange={setReminders} canRemindAssignee
            assigneeIsMe={assigneeIsMe} assigneeName={users.find((u) => u.id === assignedTo)?.full_name} hasDue={!!dueDate} hasStart={!!from} />
        </>
      )}
      {canFiles && isOpen('files') && (
        <>
          <div className="form-section">Attachments</div>
          <FilePicker files={files} onChange={setFiles} onError={setError} />
        </>
      )}

      {closedExtras.length > 0 && (
        <div className="form-extras">
          {closedExtras.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" className="extra-chip" onClick={() => open(key)}>
              <Plus size={14} /><Icon size={15} /> {label}
            </button>
          ))}
        </div>
      )}
      {error && <div className="alert error" style={{ marginTop: 14 }}>{error}</div>}
    </Drawer>
  )
}

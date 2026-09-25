import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { taskCode, type Task } from '../lib/tasks'
import type { Profile } from '../lib/types'
import { Drawer } from './Drawer'
import { Field } from './Fields'

/** Pass a task on to someone else, with an optional handover note (saved as a comment). */
export function ReassignForm({ task, users, onClose, onSaved }: {
  task: Task; users: Profile[]; onClose: () => void; onSaved: () => void
}) {
  const { profile } = useAuth()
  const [to, setTo] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const options = users.filter((u) => u.id !== task.assigned_to)

  const submit = async () => {
    if (!profile || !to) return
    setError(''); setBusy(true)
    const { error } = await supabase.from('tasks').update({ assigned_to: to }).eq('id', task.id)
    if (error) { setBusy(false); return setError(error.message) }
    if (note.trim()) {
      await supabase.from('task_comments').insert({ task_id: task.id, author_id: profile.id, body: `Handover note: ${note.trim()}` })
    }
    setBusy(false)
    onSaved()
  }

  return (
    <Drawer title={`Reassign ${taskCode(task.task_no)}`} onClose={onClose} onSubmit={submit} submitLabel="Reassign" busy={busy}>
      <dl className="detail-grid">
        <dt>Task</dt><dd>{task.title}</dd>
        <dt>Currently With</dt><dd>{task.assignee?.full_name ?? '—'}</dd>
        <dt>Created By</dt><dd>{task.creator?.full_name ?? '—'}</dd>
      </dl>
      <Field label="Reassign To" required>
        <select required autoFocus value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Select person</option>
          {options.map((u) => <option key={u.id} value={u.id}>{u.full_name}{u.id === profile?.id ? ' (me)' : ''}</option>)}
        </select>
      </Field>
      <Field label="Handover Note" hint="Optional. Added to the task's comments so the next person has context.">
        <textarea rows={3} placeholder="e.g. Please call the client after 4 pm" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="alert ok" style={{ background: 'var(--primary-softer)', color: 'var(--text)' }}>
        The new person will see it under <b>Assigned to Me</b>. You{task.created_by !== profile?.id && task.creator ? ` and ${task.creator.full_name}` : ''} will
        keep tracking it under <b>Assigned by Me</b>.
      </div>
      {error && <div className="alert error">{error}</div>}
    </Drawer>
  )
}

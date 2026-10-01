import { useEffect, useState } from 'react'
import { AlarmClock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { type TaskPriority } from '../lib/tasks'
import { PriorityBadge } from '../components/TaskBits'
import { loadReminderRules, minutesLabel, REMINDER_PRESETS, type ReminderRule } from '../lib/reminders'

const ORDER: TaskPriority[] = ['urgent', 'high', 'medium', 'low']

/** Settings → Reminders: automatic reminders added to every new one-time task, per priority. */
export function ReminderSettings() {
  const [rules, setRules] = useState<ReminderRule[]>([])
  const [saved, setSaved] = useState<string>('')
  const [error, setError] = useState('')
  useEffect(() => { loadReminderRules(true).then(setRules) }, [])

  const change = async (priority: TaskPriority, field: 'assignee_minutes' | 'assigner_minutes', value: string) => {
    setError('')
    const v = value ? Number(value) : null
    const prev = rules
    setRules((rs) => rs.map((r) => (r.priority === priority ? { ...r, [field]: v } : r)))
    const { error } = await supabase.from('reminder_rules').update({ [field]: v }).eq('priority', priority)
    if (error) { setRules(prev); setError(error.message); return }
    loadReminderRules(true)
    setSaved(priority); window.setTimeout(() => setSaved(''), 1500)
  }

  const select = (r: ReminderRule, field: 'assignee_minutes' | 'assigner_minutes') => (
    <select value={r[field] ?? ''} onChange={(e) => change(r.priority, field, e.target.value)}>
      <option value="">No reminder</option>
      {REMINDER_PRESETS.map((m) => <option key={m} value={m}>{minutesLabel(m)} before the deadline</option>)}
    </select>
  )

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Reminders</h2>
          <p>Automatic reminders added to every new one-time task, by priority. They pop up as a phone notification (for people who turned them on in My Profile → Phone Notifications) and in Notifications → Reminders, and aren't sent if the task is already done. Anyone can still add or remove reminders in a task's details. Recurring tasks don't get reminders.</p>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="panel">
        <div className="panel-toolbar">
          <span className="tab-chip"><AlarmClock size={18} /> Automatic reminders</span>
          <span className="spacer" />
          <span className="muted small">Deadline = the task's end time, or 7:00 pm if it has no time.</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Priority</th><th>Remind the assignee</th><th>Remind the person who assigned it</th><th /></tr></thead>
            <tbody>
              {ORDER.map((p) => {
                const r = rules.find((x) => x.priority === p)
                if (!r) return null
                return (
                  <tr key={p}>
                    <td><PriorityBadge priority={p} /></td>
                    <td>{select(r, 'assignee_minutes')}</td>
                    <td>{select(r, 'assigner_minutes')}</td>
                    <td className="small">{saved === p && <span className="ok-text">Saved</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small rem-settings-foot">Changes apply to tasks created from now on. Changing a task's priority later swaps its automatic reminders for the new priority's. If someone gives a task to themselves, only the assignee reminder is added.</p>
      </div>
    </>
  )
}

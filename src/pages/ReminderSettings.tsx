import { useEffect, useState } from 'react'
import { AlarmClock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { type TaskPriority } from '../lib/tasks'
import { PriorityBadge } from '../components/TaskBits'
import { loadReminderRules, minutesLabel, RELATIONS, REMINDER_PRESETS, type ReminderRule } from '../lib/reminders'

const ORDER: TaskPriority[] = ['urgent', 'high', 'medium', 'low']

/** Settings → Reminders: automatic reminders added to every new one-time task, per priority. */
export function ReminderSettings() {
  const [rules, setRules] = useState<ReminderRule[]>([])
  const [saved, setSaved] = useState<string>('')
  const [error, setError] = useState('')
  useEffect(() => { loadReminderRules(true).then(setRules) }, [])

  const change = async (priority: TaskPriority, patch: Partial<ReminderRule>) => {
    setError('')
    const prev = rules
    setRules((rs) => rs.map((r) => (r.priority === priority ? { ...r, ...patch } : r)))
    const { error } = await supabase.from('reminder_rules').update(patch).eq('priority', priority)
    if (error) { setRules(prev); setError(error.message); return }
    loadReminderRules(true)
    setSaved(priority); window.setTimeout(() => setSaved(''), 1500)
  }

  /** [30 min ▾] [before the start ▾] for one person on one priority. */
  const select = (r: ReminderRule, who: 'assignee' | 'assigner') => {
    const minutes = r[`${who}_minutes`]
    const rel = `${r[`${who}_direction`]}:${r[`${who}_anchor`]}`
    const setRel = (v: string) => {
      const x = RELATIONS.find((o) => o.value === v)!
      change(r.priority, { [`${who}_direction`]: x.direction, [`${who}_anchor`]: x.anchor } as Partial<ReminderRule>)
    }
    return (
      <div className="rule-cell">
        <select value={minutes ?? ''} aria-label="How long"
          onChange={(e) => {
            const v = e.target.value === '' ? null : Number(e.target.value)
            // "Right at…" only makes sense as "at the start / end"
            const patch = { [`${who}_minutes`]: v } as Partial<ReminderRule>
            if (v === 0 && rel.startsWith('after')) Object.assign(patch, { [`${who}_direction`]: 'before' })
            change(r.priority, patch)
          }}>
          <option value="">No reminder</option>
          {REMINDER_PRESETS.map((m) => <option key={m} value={m}>{m === 0 ? 'Right' : minutesLabel(m)}</option>)}
        </select>
        {minutes != null && (
          <select value={rel} onChange={(e) => setRel(e.target.value)} aria-label="Before or after the start or end">
            {(minutes === 0 ? RELATIONS.filter((o) => o.direction === 'before') : RELATIONS)
              .map((o) => <option key={o.value} value={o.value}>{minutes === 0 ? `at the ${o.anchor}` : o.label}</option>)}
          </select>
        )}
      </div>
    )
  }

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
          <span className="muted small">Start = the task's start time · End = its end time, or 7:00 pm if it has no time.</span>
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
                    <td>{select(r, 'assignee')}</td>
                    <td>{select(r, 'assigner')}</td>
                    <td className="small">{saved === p && <span className="ok-text">Saved</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small rem-settings-foot">Start-based reminders are only sent for tasks that have a start time. Changes apply to tasks created from now on. Changing a task's priority later swaps its automatic reminders for the new priority's. If someone gives a task to themselves, only the assignee reminder is added.</p>
      </div>
    </>
  )
}

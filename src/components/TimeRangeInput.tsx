import { timeLength } from '../lib/tasks'
import { Field } from './Fields'

/** Optional From–To time. Values are "HH:MM" strings; empty = no time. */
export function TimeRangeInput({ from, to, onChange, label = 'Time', hint }: {
  from: string; to: string; onChange: (from: string, to: string) => void; label?: string; hint?: string
}) {
  const len = from && to ? timeLength(from, to) : ''
  const invalid = !!from && !!to && !len
  return (
    <Field label={label} hint={hint}>
      <div className="time-range">
        <input type="time" step={300} aria-label="From" value={from}
          onChange={(e) => onChange(e.target.value, to || addHour(e.target.value))} />
        <span className="muted">to</span>
        <input type="time" step={300} aria-label="To" value={to} onChange={(e) => onChange(from, e.target.value)} />
        {(from || to) && <button type="button" className="link" onClick={() => onChange('', '')}>Clear</button>}
      </div>
      {invalid ? <small className="overdue-text">End time must be after start time</small>
        : len ? <small>Duration: {len}</small> : null}
    </Field>
  )
}

function addHour(t: string) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return h >= 23 ? '23:59' : `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Validate a pair before saving: both empty, or both set with end > start. */
export function timePairError(from: string, to: string) {
  if (!from && !to) return ''
  if (!from || !to) return 'Enter both From and To time, or clear both'
  return timeLength(from, to) ? '' : 'End time must be after start time'
}

export const toDbTime = (t: string) => (t ? `${t.slice(0, 5)}:00` : null)
export const fromDbTime = (t: string | null) => (t ? t.slice(0, 5) : '')

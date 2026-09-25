import { WEEKDAYS } from '../lib/tasks'

/** Toggle chips for Sun–Sat, plus quick presets. Value uses 0 = Sunday … 6 = Saturday. */
export function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (d: number[]) => void }) {
  const toggle = (d: number) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort())
  const order = [1, 2, 3, 4, 5, 6, 0]   // show Monday first
  return (
    <div>
      <div className="weekday-chips">
        {order.map((d) => (
          <button type="button" key={d} className={value.includes(d) ? 'on' : ''} aria-pressed={value.includes(d)} onClick={() => toggle(d)}>
            {WEEKDAYS[d]}
          </button>
        ))}
      </div>
      <div className="weekday-presets">
        <button type="button" className="link" onClick={() => onChange([1, 2, 3, 4, 5, 6])}>Mon–Sat</button>
        <button type="button" className="link" onClick={() => onChange([1, 2, 3, 4, 5])}>Mon–Fri</button>
        <button type="button" className="link" onClick={() => onChange([0, 1, 2, 3, 4, 5, 6])}>Every day</button>
      </div>
    </div>
  )
}

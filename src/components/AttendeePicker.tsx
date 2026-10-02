import { X } from 'lucide-react'
import type { Profile } from '../lib/types'
import { initials } from '../lib/initials'

/** Pick meeting attendees: the organiser (fixed chip) + chips for the people chosen + an "Add person…" list. */
export function AttendeePicker({ users, value, onChange, organiserId, extraNames = {} }: {
  users: Profile[]
  value: string[]
  onChange: (ids: string[]) => void
  organiserId?: string
  /** Names for people no longer in `users` (e.g. deactivated). */
  extraNames?: Record<string, string>
}) {
  const name = (id: string) => users.find((u) => u.id === id)?.full_name ?? extraNames[id] ?? 'Someone'
  const left = users.filter((u) => u.id !== organiserId && !value.includes(u.id))
  return (
    <div className="att-picker">
      <div className="att-chips">
          {organiserId && (
            <span className="att-chip organiser" title="The organiser is always in the meeting">
              <span className="att-avatar">{initials(name(organiserId))}</span>{name(organiserId)}
              <span className="att-tag">Organiser</span>
            </span>
          )}
          {value.map((id) => (
            <span key={id} className="att-chip">
              <span className="att-avatar">{initials(name(id))}</span>{name(id)}
              <button type="button" className="icon" aria-label={`Remove ${name(id)}`} onClick={() => onChange(value.filter((v) => v !== id))}><X size={13} /></button>
            </span>
          ))}
      </div>
      {left.length > 0 && (
        <div className="att-add">
          <select value="" onChange={(e) => { if (e.target.value) onChange([...value, e.target.value]) }} aria-label="Add person">
            <option value="">+ Add person…</option>
            {left.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          {left.length > 1 && <button type="button" className="link" onClick={() => onChange([...value, ...left.map((u) => u.id)])}>Add everyone</button>}
        </div>
      )}
    </div>
  )
}

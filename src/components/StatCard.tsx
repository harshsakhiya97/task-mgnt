import type { LucideIcon } from 'lucide-react'

export type Tone = 'navy' | 'blue' | 'yellow' | 'purple' | 'green' | 'orange' | 'teal' | 'red'

export function StatCard({ icon: Icon, tone, value, label, onClick, active }: {
  icon: LucideIcon; tone: Tone; value: string | number; label: string
  /** Makes the card a filter shortcut. */
  onClick?: () => void; active?: boolean
}) {
  if (onClick) {
    return (
      <button type="button" className={`stat stat-btn ${active ? 'active' : ''}`} onClick={onClick} aria-pressed={active}>
        <div className={`stat-icon tone-${tone}`}><Icon size={20} /></div>
        <b>{value}</b>
        <span>{label}</span>
      </button>
    )
  }
  return (
    <div className="stat">
      <div className={`stat-icon tone-${tone}`}><Icon size={20} /></div>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  )
}

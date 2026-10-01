import type { LucideIcon } from 'lucide-react'

export type Tone = 'navy' | 'blue' | 'yellow' | 'purple' | 'green' | 'orange' | 'teal' | 'red'

/** On a phone the cards fill the screen, so after picking one, scroll down to the list it filters
 *  (the first .panel after the cards). */
function scrollToList(card: HTMLElement) {
  if (!window.matchMedia('(max-width: 800px)').matches) return
  let el = card.closest('.stats')?.nextElementSibling ?? null
  while (el && !el.classList.contains('panel')) el = el.nextElementSibling
  const list = el
  if (list) requestAnimationFrame(() => list.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

export function StatCard({ icon: Icon, tone, value, label, onClick, active }: {
  icon: LucideIcon; tone: Tone; value: string | number; label: string
  /** Makes the card a filter shortcut. */
  onClick?: () => void; active?: boolean
}) {
  if (onClick) {
    return (
      <button type="button" className={`stat stat-btn ${active ? 'active' : ''}`} onClick={(e) => { onClick(); scrollToList(e.currentTarget) }} aria-pressed={active}>
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

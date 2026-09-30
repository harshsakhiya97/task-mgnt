import { useSearchParams } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'

/** The sub-tab shown on a Settings page, kept in the address (?view=…) next to the main ?tab=. */
export function useSubView<T extends string>(views: readonly T[], fallback: T) {
  const [params, setParams] = useSearchParams()
  const v = params.get('view') as T | null
  const view: T = v && views.includes(v) ? v : fallback
  const setView = (next: T) => setParams((p) => { const n = new URLSearchParams(p); n.set('view', next); return n })
  return [view, setView] as const
}

/** Small segmented tabs under a page title (e.g. "Messages" / "Configuration"). */
export function SubTabs<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string; icon?: LucideIcon; badge?: string | number }[]
}) {
  return (
    <div className="segmented sub-tabs" role="tablist">
      {options.map(({ value: v, label, icon: Icon, badge }) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {Icon && <Icon size={15} />} {label}{badge !== undefined && <span className="sub-tab-badge">{badge}</span>}
        </button>
      ))}
    </div>
  )
}

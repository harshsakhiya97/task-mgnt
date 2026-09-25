import { useEffect, type FormEvent, type ReactNode } from 'react'
import { X } from 'lucide-react'

/** Right-hand slide-over panel with a Cancel / primary action footer. */
export function Drawer({ title, onClose, onSubmit, submitLabel, busy, children, hideSubmit }: {
  title: string
  onClose: () => void
  onSubmit?: (e: FormEvent) => void
  submitLabel?: string
  busy?: boolean
  hideSubmit?: boolean
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="overlay" onMouseDown={(e) => { e.stopPropagation(); onClose() }}>
      <form className="drawer" role="dialog" aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); onSubmit?.(e) }}>
        <div className="drawer-head">
          <h3>{title}</h3>
          <button type="button" className="icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="drawer-body">{children}</div>
        <div className="drawer-foot">
          <button type="button" className="secondary" onClick={onClose}>{hideSubmit ? 'Close' : 'Cancel'}</button>
          {!hideSubmit && <button type="submit" disabled={busy}>{busy ? 'Saving…' : submitLabel ?? 'Save'}</button>}
        </div>
      </form>
    </div>
  )
}

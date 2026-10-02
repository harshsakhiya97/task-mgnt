import type { ReactNode } from 'react'

/** Centered confirmation box, e.g. "Ready to leave?". */
export function ConfirmDialog({ icon, title, message, confirmLabel, tone = 'danger', busy, onConfirm, onCancel, children }: {
  icon: ReactNode
  title: string
  message: string
  confirmLabel: string
  tone?: 'danger' | 'info'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
  /** Extra content (e.g. an input) under the message. */
  children?: ReactNode
}) {
  return (
    <div className="dialog-wrap" onMouseDown={(e) => { e.stopPropagation(); onCancel() }}>
      <div className="dialog" role="alertdialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className={`dialog-icon ${tone === 'info' ? 'info' : ''}`}>{icon}</div>
        <h3>{title}</h3>
        <p>{message}</p>
        {children}
        <div className="dialog-actions">
          <button className="secondary" onClick={onCancel}>Cancel</button>
          <button className={tone === 'danger' ? 'danger' : ''} disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

import { Repeat } from 'lucide-react'

/** "This is a recurring task. Change only this date, or every day?" */
export function RecurringScopeDialog({ canAll, busy, onOnly, onAll, onCancel }: {
  canAll: boolean; busy?: boolean; onOnly: () => void; onAll: () => void; onCancel: () => void
}) {
  return (
    <div className="dialog-wrap" onMouseDown={(e) => { e.stopPropagation(); onCancel() }}>
      <div className="dialog scope-dialog" role="alertdialog" aria-label="Recurring task" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-icon info"><Repeat size={30} /></div>
        <h3>This is a recurring task</h3>
        <p>Change the time for this date only, or for every day?</p>
        <div className="scope-actions">
          <button disabled={busy} onClick={onOnly}>Only this date</button>
          <button disabled={busy || !canAll} onClick={onAll} title={canAll ? '' : 'Only the creator or an admin can change the schedule'}>Every day</button>
          <button className="secondary" disabled={busy} onClick={onCancel}>Cancel</button>
        </div>
        {!canAll && <small className="muted">Only the person who created this recurring task (or an admin) can change it for every day.</small>}
      </div>
    </div>
  )
}

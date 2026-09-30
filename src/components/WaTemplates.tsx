import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { checkWati, templateTone, type WatiCheck } from './WatiConnection'
import { renderWhatsApp, WA_KIND_LABELS, WA_SAMPLES, WA_TEMPLATES, WA_WHEN } from '../lib/whatsappTemplates'

const KINDS = ['task_assigned', 'task_comment', 'daily_task_report', 'task_unassigned']

/** Settings → WhatsApp → Templates: every message template the app sends, with its WATI approval status. */
export function WaTemplates() {
  const [check, setCheck] = useState<WatiCheck | null>(null)
  const [busy, setBusy] = useState(false)
  const run = () => { setBusy(true); checkWati().then((c) => { setCheck(c); setBusy(false) }) }
  useEffect(run, [])

  const statusOf = (kind: string) => check?.templates?.find((t) => t.kind === kind)
  const approved = check?.templates?.filter((t) => t.status === 'APPROVED').length ?? 0

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <span className="tab-chip">Message templates</span>
        <span className="count-pill">{KINDS.length} Templates</span>
        {check?.templates && <span className={`badge ${approved === KINDS.length ? 'active' : 'manager'}`}>{approved}/{KINDS.length} approved in WATI</span>}
        <span className="spacer" />
        <button className="secondary small-btn" onClick={run} disabled={busy}><RefreshCw size={14} className={busy ? 'spin' : undefined} /> {busy ? 'Checking WATI…' : 'Refresh status'}</button>
      </div>
      {check && !check.ok && check.error && <div className="alert error wa-tpl-alert">Can't read the status from WATI: {check.error}</div>}
      <div className="table-scroll">
        <table className="wa-tpl-table">
          <thead><tr><th>Template</th><th>Template message</th><th>Example message</th></tr></thead>
          <tbody>
            {KINDS.map((kind) => {
              const st = statusOf(kind)
              return (
                <tr key={kind}>
                  <td className="wa-tpl-name">
                    <code>{st?.name ?? kind}</code>
                    <div className="wa-tpl-label">{WA_KIND_LABELS[kind]}</div>
                    <div className="muted small">{WA_WHEN[kind]}</div>
                    <div className="wa-tpl-status">
                      {busy && !check ? <span className="badge">Checking…</span>
                        : st ? <span className={`badge ${templateTone(st.status)}`}>{st.status === 'MISSING' ? 'Not created in WATI' : st.status.toLowerCase()}</span>
                        : <span className="badge inactive">Status unknown</span>}
                    </div>
                  </td>
                  <td><div className="wa-tpl-text">{WA_TEMPLATES[kind]}</div></td>
                  <td><div className="wa-bubble wa-tpl-text">{renderWhatsApp(kind, WA_SAMPLES[kind])}</div></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

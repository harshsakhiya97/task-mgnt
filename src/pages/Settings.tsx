import { useSearchParams } from 'react-router-dom'
import { Health } from './Health'
import { Perisclaw } from './Perisclaw'
import { WhatsAppLogs } from './WhatsAppLogs'

export type SettingsTab = 'perisclaw' | 'whatsapp' | 'system'
export const SETTINGS_TABS: Record<SettingsTab, string> = {
  perisclaw: 'Perisclaw',
  whatsapp: 'WhatsApp',
  system: 'System Check',
}
export const settingsTab = (t: string | null): SettingsTab => (t === 'whatsapp' || t === 'system' ? t : 'perisclaw')

/** Admin → Settings: Perisclaw, WhatsApp Logs and System Check as tabs (?tab=…). */
export function Settings() {
  const [params, setParams] = useSearchParams()
  const tab = settingsTab(params.get('tab'))
  return (
    <>
      <div className="view-tabs settings-tabs" role="tablist" aria-label="Settings">
        {(Object.keys(SETTINGS_TABS) as SettingsTab[]).map((v) => (
          <button key={v} role="tab" aria-selected={tab === v} className={tab === v ? 'active' : ''}
            onClick={() => setParams(v === 'perisclaw' ? {} : { tab: v })}>{SETTINGS_TABS[v]}</button>
        ))}
      </div>
      {tab === 'perisclaw' ? <Perisclaw /> : tab === 'whatsapp' ? <WhatsAppLogs /> : <Health />}
    </>
  )
}

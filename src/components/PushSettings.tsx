import { useState } from 'react'
import { BellRing, BellOff, Send, X } from 'lucide-react'
import { usePush, type PushState } from '../lib/push'
import { isIOS } from '../lib/install'
import { InstallApp } from './InstallApp'

const BLOCKED_HELP = isIOS()
  ? 'Notifications are blocked. On your iPhone open Settings → Notifications → Task Mgnt and turn on Allow Notifications.'
  : 'Notifications are blocked for this site. Tap the lock (or ⓘ) next to the address → Permissions → Notifications → Allow, then reload. In the installed app: long-press the icon → App info → Notifications.'

/** My Profile → Phone Notifications: turn reminder notifications on/off for this device, and send a test. */
export function PushSettings() {
  const { state, busy, error, enable, disable, test } = usePush()
  const [tested, setTested] = useState(false)
  return (
    <div className="push-card">
      <div className="push-head">
        <div className={`push-icon ${state === 'on' ? 'on' : ''}`}>{state === 'on' ? <BellRing size={20} /> : <BellOff size={20} />}</div>
        <div>
          <b>Reminders on this device</b>
          <p className="muted small">{STATE_TEXT[state]}</p>
        </div>
      </div>
      <p className="small push-what">Get a phone notification when a task reminder is due — even when Task Mgnt is closed.
        Tap it to open the task. New tasks and comments still come on WhatsApp.</p>
      {state === 'needs-install' && (
        <>
          <p className="small">On iPhone, phone notifications work only in the installed app (iOS 16.4 or newer). Add Task Mgnt to your home screen, open it from there, and turn them on.</p>
          <InstallApp />
        </>
      )}
      {state === 'denied' && <p className="alert error small">{BLOCKED_HELP}</p>}
      {state === 'unsupported' && <p className="small muted">This browser can't show notifications. On a phone, use Chrome (Android) or the installed app (iPhone).</p>}
      <div className="push-actions">
        {state === 'off' && <button onClick={enable} disabled={busy}><BellRing size={16} /> {busy ? 'Turning on…' : 'Turn on reminder notifications'}</button>}
        {state === 'on' && <>
          <button className="secondary" onClick={async () => { await test(); setTested(true) }} disabled={busy}><Send size={16} /> Send a test notification</button>
          <button className="secondary" onClick={disable} disabled={busy}><BellOff size={16} /> Turn off on this device</button>
        </>}
      </div>
      {tested && !error && state === 'on' && <p className="small ok-text">Test sent — it should pop up in a few seconds. Nothing came? Check that notifications for Task Mgnt (or Chrome) aren't muted in the phone's settings.</p>}
      {error && <p className="alert error small">{error}</p>}
    </div>
  )
}

const STATE_TEXT: Record<PushState, string> = {
  loading: 'Checking…',
  unsupported: 'Not available in this browser',
  'needs-install': 'Install the app first',
  denied: 'Blocked in the browser settings',
  off: 'Off',
  on: 'On — reminders pop up on this device',
}

const DISMISS_KEY = 'push-prompt-dismissed'
const dismissed = () => { try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false } }

/** A small banner (Dashboard, Notifications → Reminders) until notifications are turned on. */
export function PushPrompt({ always }: { always?: boolean }) {
  const { state, busy, error, enable } = usePush()
  const [hidden, setHidden] = useState(!always && dismissed())
  if (hidden || !(state === 'off' || state === 'needs-install')) return null
  const close = () => { try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ } setHidden(true) }
  return (
    <div className="push-prompt">
      <BellRing size={20} />
      <div className="push-prompt-text">
        <b>Get reminders as phone notifications</b>
        <span className="small">{state === 'needs-install'
          ? 'On iPhone, first add Task Mgnt to your home screen, then turn them on from the app.'
          : 'They pop up when a task is due, even when the app is closed.'}</span>
        {error && <span className="small error-text">{error}</span>}
      </div>
      {state === 'off'
        ? <button onClick={enable} disabled={busy}>{busy ? 'Turning on…' : 'Turn on'}</button>
        : <InstallApp compact />}
      {!always && <button className="icon" onClick={close} aria-label="Not now" title="Not now"><X size={16} /></button>}
    </div>
  )
}

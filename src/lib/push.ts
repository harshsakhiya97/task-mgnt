import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { isIOS, isStandalone } from './install'

/**
 * Phone notifications (Web Push) for reminders.
 * The browser gives us a "subscription" (an address at Google / Apple / Mozilla); we save it in push_subscriptions
 * and the push-sender Edge Function sends reminders to it. Works on Android (Chrome, Edge, Samsung), desktop browsers,
 * and on iPhone (iOS 16.4+) only when Task Mgnt was added to the home screen.
 */
export type PushState =
  | 'loading'
  | 'unsupported'     // this browser can't do it
  | 'needs-install'   // iPhone in Safari: add to home screen first
  | 'denied'          // notifications blocked for this site in the browser / phone settings
  | 'off'
  | 'on'

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

async function registration(timeoutMs = 5000): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  const existing = await navigator.serviceWorker.getRegistration()
  if (!existing) await navigator.serviceWorker.register('/sw.js').catch(() => null)
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))])
}

const keyBytes = (b64: string) => {
  const s = b64.replace(/-/g, '+').replace(/_/g, '/'); const p = s + '='.repeat((4 - (s.length % 4)) % 4)
  return Uint8Array.from(atob(p), (c) => c.charCodeAt(0))
}

async function save(sub: PushSubscription) {
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  const { error } = await supabase.rpc('push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_user_agent: navigator.userAgent })
  if (error) throw new Error(error.message)
}

export async function pushState(): Promise<PushState> {
  if (isIOS() && !isStandalone()) return 'needs-install'
  if (!supported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await registration()
  if (!reg) return 'unsupported'
  const sub = await reg.pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'on' : 'off'
}

/** Ask for permission and register this device. Must be called from a tap (iPhone requires it). */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported'
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off'
  const reg = await registration()
  if (!reg) throw new Error("Couldn't start notifications in this browser. Reload the page and try again.")
  const { data: key, error } = await supabase.rpc('push_public_key')
  if (error || !key) throw new Error(error?.message ?? 'Phone notifications are not set up on the server yet')
  let sub = await reg.pushManager.getSubscription()
  const want = keyBytes(key as string)
  const sameKey = sub?.options.applicationServerKey &&
    new Uint8Array(sub.options.applicationServerKey).every((b, i) => b === want[i])
  if (sub && !sameKey) { await sub.unsubscribe(); sub = null }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want })
  await save(sub)
  return 'on'
}

/** Stop notifications on this device (also used when logging out, so the next person doesn't get my reminders). */
export async function disablePush() {
  const reg = supported() ? await registration(2000) : null
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe().catch(() => {})
}

export async function sendTestPush() {
  const { error } = await supabase.rpc('push_test')
  if (error) throw new Error(error.message)
}

/** Keep the server's copy of this device in step (the browser can renew it; or another person used this phone before). */
let synced = false
export async function syncPush() {
  if (synced || !supported() || Notification.permission !== 'granted') return
  synced = true
  const reg = await registration(3000)
  const sub = await reg?.pushManager.getSubscription()
  if (sub) await save(sub).catch(() => { synced = false })
}

export function usePush() {
  const [state, setState] = useState<PushState>('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refresh = useCallback(() => { pushState().then(setState).catch(() => setState('unsupported')) }, [])
  useEffect(() => { refresh() }, [refresh])
  const run = async (fn: () => Promise<PushState | void>) => {
    setBusy(true); setError('')
    try { const s = await fn(); if (s) setState(s); else refresh() } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    setBusy(false)
  }
  return {
    state, busy, error,
    enable: () => run(enablePush),
    disable: () => run(async () => { await disablePush(); return 'off' as PushState }),
    test: () => run(async () => { await sendTestPush() }),
  }
}

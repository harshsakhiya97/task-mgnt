import { useEffect, useState } from 'react'

/**
 * "Download this app": install Task Mgnt on the phone's home screen (it's a PWA: public/manifest.json + public/sw.js).
 * Android Chrome / Edge / Samsung Internet fire `beforeinstallprompt`, which we keep and show on the button.
 * iPhone Safari has no such prompt: the user taps Share → Add to Home Screen (we show those steps).
 */
interface InstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallPromptEvent; notify() })
  window.addEventListener('appinstalled', () => { deferred = null; notify() })
  if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}) })
  }
}

/** Opened from the home-screen icon (not in a browser tab). */
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true

export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export const isPhone = () => /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent) || window.matchMedia('(max-width: 800px)').matches

export function useInstall() {
  const [, setTick] = useState(0)
  useEffect(() => { const l = () => setTick((n) => n + 1); listeners.add(l); return () => { listeners.delete(l) } }, [])
  return {
    /** Show the button: on a phone, in the browser (not already opened as the app). */
    show: isPhone() && !isStandalone(),
    /** The browser can show its own install dialog. */
    canPrompt: !!deferred,
    ios: isIOS(),
    /** Opens the browser's install dialog; returns false when there isn't one (show the manual steps instead). */
    install: async () => {
      if (!deferred) return false
      const ev = deferred
      await ev.prompt()
      const { outcome } = await ev.userChoice
      if (outcome === 'accepted') { deferred = null; notify() }
      return true
    },
  }
}

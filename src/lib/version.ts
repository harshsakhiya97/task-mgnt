/** From package.json: "1.2.0" → "Version 1.2", "1.2.1" → "Version 1.2.1" (the patch number only shows when it isn't 0). */
export const APP_VERSION = __APP_VERSION__
const [maj, min, patch] = APP_VERSION.split('.')
export const VERSION_NUMBER = patch && patch !== '0' ? `${maj}.${min}.${patch}` : `${maj}.${min}`
export const VERSION_LABEL = `Version ${VERSION_NUMBER}`
export const VERSION_SHORT = `v${VERSION_NUMBER}`

/** The newest version this browser has seen on the What's New page (for the "updated" dot). */
const SEEN_KEY = 'whats-new-seen'
export function hasUnseenUpdate(): boolean {
  try { return localStorage.getItem(SEEN_KEY) !== APP_VERSION } catch { return false }
}
export function markUpdateSeen() {
  try { localStorage.setItem(SEEN_KEY, APP_VERSION) } catch { /* private window etc. */ }
}

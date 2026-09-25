/** "1.0.0" from package.json → shown as "Version 1.0". */
export const APP_VERSION = __APP_VERSION__
export const VERSION_LABEL = `Version ${APP_VERSION.split('.').slice(0, 2).join('.')}`
export const VERSION_SHORT = `v${APP_VERSION.split('.').slice(0, 2).join('.')}`

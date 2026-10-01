// Task Mgnt service worker: makes the site installable as an app ("Add to Home screen") and shows
// phone notifications (reminders, new tasks, comments — Web Push, sent by the push-sender Edge Function).
// It does not cache the app or its data, so every launch always loads the latest version from the server.
// When the phone is offline, page loads show a short "You're offline" message instead of the browser's error.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

const OFFLINE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Task Mgnt</title><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#1f2433;text-align:center">
<div><div style="width:64px;height:64px;border-radius:50%;background:#2e3787;color:#fff;display:grid;place-items:center;font:700 24px Georgia,serif;margin:0 auto 16px">TM</div>
<h2 style="margin:0 0 8px">You're offline</h2><p style="color:#6b7280;margin:0 0 20px">Task Mgnt needs the internet. Check your connection and try again.</p>
<button onclick="location.reload()" style="background:#2e3787;color:#fff;border:0;border-radius:8px;padding:10px 20px;font-size:15px">Try again</button></div>`

self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return   // everything else goes straight to the network as usual
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })))
})

// ---------- Phone notifications (reminders) ----------
self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { body: e.data ? e.data.text() : '' } }
  e.waitUntil(self.registration.showNotification(d.title || 'Task Mgnt', {
    body: d.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,   // a newer comment on the same task replaces the older one but still alerts
    data: { url: d.url || '/' },
    vibrate: [120, 60, 120],
  }))
})

// Tap on a notification: open that task (in the open app window if there is one).
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const win = list.find((c) => new URL(c.url).origin === self.location.origin)
    if (win) {
      await win.focus()
      try { await win.navigate(url); return } catch { win.postMessage({ type: 'open', url }); return }
    }
    await self.clients.openWindow(url)
  })())
})

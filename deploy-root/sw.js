// Old Task Mgnt service worker (when the app lived at the site root). The app is now at /task/ with its own
// worker, so this one removes itself from phones / browsers that still have it.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.registration.unregister()))

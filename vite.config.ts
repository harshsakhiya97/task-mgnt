import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// App version shown in the sidebar and on the login page — bump "version" in package.json for a new release.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// The app is served from a sub-folder: https://pride.viralsakhiya.com/task/
// To move it, change APP_BASE here and RewriteBase / the index.html rule in public/.htaccess.
const APP_BASE = '/task/'
export default defineConfig({
  plugins: [react()],
  base: APP_BASE,
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __APP_VERSION__: JSON.stringify(version),
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// App version shown in the sidebar and on the login page — bump "version" in package.json for a new release.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// base '/' = app is served from the root of a domain/subdomain
// (e.g. execution.viralsakhiya.com). If you deploy into a sub-folder
// like example.com/app/, change this to '/app/' and update .htaccess.
export default defineConfig({
  plugins: [react()],
  base: '/',
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __APP_VERSION__: JSON.stringify(version),
  },
})

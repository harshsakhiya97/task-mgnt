import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import { NotificationsProvider } from './notifications/NotificationsProvider'
import './index.css'
import './lib/install'   // registers the service worker and catches the browser's install prompt early

// Scrolling over a focused number box (views, hours…) would change its value: drop the focus instead, so the page scrolls.
document.addEventListener('wheel', (e) => {
  const el = document.activeElement
  if (el instanceof HTMLInputElement && el.type === 'number' && e.target === el) el.blur()
}, { passive: true })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <NotificationsProvider>
          <App />
        </NotificationsProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)

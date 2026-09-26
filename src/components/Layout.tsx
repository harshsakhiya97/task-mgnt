import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Activity, BarChart3, Bell, MessageCircle, CalendarDays, ClipboardList, LayoutGrid, type LucideIcon, LogOut, Menu, PanelLeft, UserRound, Users } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { APP_VERSION, VERSION_LABEL, VERSION_SHORT } from '../lib/version'
import { initials } from '../lib/initials'
import type { Role } from '../lib/types'
import { Brand } from './Brand'
import { LogoutDialog } from './LogoutDialog'
import { NotificationBell } from '../notifications/NotificationBell'
import { useNotifications } from '../notifications/NotificationsProvider'

interface NavDef { to: string; label: string; icon: LucideIcon; roles?: Role[] }
const SECTIONS: { title: string; items: NavDef[] }[] = [
  {
    title: 'General',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutGrid },
      { to: '/notifications', label: 'Notifications', icon: Bell },
    ],
  },
  {
    title: 'Task Management',
    items: [
      { to: '/tasks', label: 'Tasks', icon: ClipboardList },
      { to: '/calendar', label: 'Calendar', icon: CalendarDays },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/reports', label: 'Reports', icon: BarChart3, roles: ['admin'] },
      { to: '/whatsapp-logs', label: 'WhatsApp Logs', icon: MessageCircle, roles: ['admin'] },
      { to: '/users', label: 'Users & Roles', icon: Users, roles: ['admin'] },
      { to: '/health', label: 'System Check', icon: Activity, roles: ['admin'] },
    ],
  },
  { title: 'Account', items: [{ to: '/profile', label: 'My Profile', icon: UserRound }] },
]

/** Page title + breadcrumb shown in the top bar, keyed by path. */
const TITLES: Record<string, [string, string]> = {
  '/': ['Dashboard', 'Overview'],
  '/tasks': ['Tasks', 'Overview'],
  '/notifications': ['Notifications', 'Overview'],
  '/calendar': ['Calendar', 'Overview'],
  '/reports': ['Reports', 'Overview'],
  '/whatsapp-logs': ['WhatsApp Logs', 'Overview'],
  '/users': ['Users & Roles', 'Overview'],
  '/health': ['System Check', 'Overview'],
  '/profile': ['Settings', 'My Profile'],
}

function readCollapsed() {
  try { return localStorage.getItem('sidebar-collapsed') === '1' } catch { return false }
}

export function Layout() {
  const { profile } = useAuth()
  const { unread } = useNotifications()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)

  useEffect(() => { setMobileOpen(false) }, [location.pathname])
  // Keep the app's web address (used in WhatsApp links) in sync with where admins open it.
  // The database ignores local/dev addresses, so this is safe on localhost.
  useEffect(() => {
    if (profile?.role === 'admin') supabase.rpc('sync_app_url', { p_url: window.location.origin }).then(() => {})
  }, [profile?.role])
  useEffect(() => {
    try { localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0') } catch { /* ignore */ }
  }, [collapsed])

  if (!profile) return null
  const [title, sub] = TITLES[location.pathname] ?? ['Task Mgnt', '']
  const Icon = SECTIONS.flatMap((s) => s.items).find((i) => i.to === location.pathname)?.icon ?? LayoutGrid

  return (
    <div className={`app ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-head">
          <Brand />
          <button className="icon collapse-btn" onClick={() => setCollapsed((c) => !c)} aria-label="Toggle sidebar">
            <PanelLeft size={22} />
          </button>
        </div>
        <nav>
          {SECTIONS.map((section) => {
            const items = section.items.filter((i) => !i.roles || i.roles.includes(profile.role))
            if (!items.length) return null
            return (
              <div key={section.title}>
                <div className="nav-section">{section.title}</div>
                {items.map(({ to, label, icon: ItemIcon }) => (
                  <NavLink key={to} to={to} end className="nav-item" title={label}>
                    <ItemIcon size={20} /><span>{label}</span>
                    {to === '/notifications' && unread > 0 && <span className="nav-count">{unread > 99 ? '99+' : unread}</span>}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>
        <div className="sidebar-user">
          <div className="avatar">{initials(profile.full_name)}</div>
          <div className="who"><b>{profile.full_name}</b><small>{profile.email}</small></div>
          <button className="icon" onClick={() => setConfirmLogout(true)} aria-label="Log out" title="Log out">
            <LogOut size={20} />
          </button>
        </div>
        <div className="app-version" title={`Task Mgnt ${APP_VERSION}`}>
          <span className="long">{VERSION_LABEL}</span><span className="short">{VERSION_SHORT}</span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="icon menu-btn" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu size={22} /></button>
          <div className="crumb"><Icon size={22} /> {title} {sub && <small>{sub}</small>}</div>
          <div className="topbar-right"><NotificationBell /></div>
        </header>
        <main className="content"><Outlet /></main>
      </div>

      {mobileOpen && <div className="overlay" style={{ zIndex: 30 }} onClick={() => setMobileOpen(false)} />}
      {confirmLogout && <LogoutDialog onCancel={() => setConfirmLogout(false)} />}
    </div>
  )
}

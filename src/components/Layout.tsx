import { InstallApp } from './InstallApp'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { BarChart3, Bell, CalendarDays, ClipboardList, LayoutGrid, type LucideIcon, LogOut, Menu, PanelLeft, Sparkles, Settings as SettingsIcon, UserRound, Users } from 'lucide-react'
import { SETTINGS_TABS, settingsTab } from '../pages/Settings'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { APP_VERSION, hasUnseenUpdate, VERSION_LABEL, VERSION_SHORT } from '../lib/version'
import { initials } from '../lib/initials'
import type { Role } from '../lib/types'
import { Brand } from './Brand'
import { LogoutDialog } from './LogoutDialog'
import { NotificationBell } from '../notifications/NotificationBell'

interface NavDef { to: string; label: string; icon: LucideIcon; roles?: Role[] }
const SECTIONS: { title: string; items: NavDef[] }[] = [
  {
    title: 'General',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutGrid },
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
      { to: '/users', label: 'Users & Roles', icon: Users, roles: ['admin'] },
      { to: '/settings', label: 'Settings', icon: SettingsIcon, roles: ['admin'] },
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
  '/users': ['Users & Roles', 'Overview'],
  '/profile': ['My Profile', 'Account'],
  '/whats-new': ["What's New", 'Version history'],
}

function readCollapsed() {
  try { return localStorage.getItem('sidebar-collapsed') === '1' } catch { return false }
}

export function Layout() {
  const { profile } = useAuth()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)

  const [unseen, setUnseen] = useState(hasUnseenUpdate)
  useEffect(() => { setMobileOpen(false); setUnseen(hasUnseenUpdate()) }, [location.pathname])
  // Keep the app's web address (used in WhatsApp links) in sync with where admins open it.
  // The database ignores local/dev addresses, so this is safe on localhost.
  useEffect(() => {
    if (profile?.role === 'admin') supabase.rpc('sync_app_url', { p_url: window.location.origin }).then(() => {})
  }, [profile?.role])
  useEffect(() => {
    try { localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0') } catch { /* ignore */ }
  }, [collapsed])

  if (!profile) return null
  const [title, sub] = location.pathname === '/settings'
    ? ['Settings', SETTINGS_TABS[settingsTab(new URLSearchParams(location.search).get('tab'))]]
    : TITLES[location.pathname] ?? ['Task Mgnt', '']
  const Icon = SECTIONS.flatMap((s) => s.items).find((i) => i.to === location.pathname)?.icon ?? (location.pathname === '/whats-new' ? Sparkles : location.pathname === '/notifications' ? Bell : LayoutGrid)

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
                  </NavLink>
                ))}
              </div>
            )
          })}
          <InstallApp variant="nav" />
        </nav>
        <div className="sidebar-user">
          <div className="avatar">{initials(profile.full_name)}</div>
          <div className="who"><b>{profile.full_name}</b><small>{profile.email}</small></div>
          <button className="icon" onClick={() => setConfirmLogout(true)} aria-label="Log out" title="Log out">
            <LogOut size={20} />
          </button>
        </div>
        <Link to="/whats-new" className="app-version" title={`Task Mgnt ${APP_VERSION} · What's new`}>
          <span className="long">{VERSION_LABEL} · What's new</span><span className="short">{VERSION_SHORT}</span>
          {unseen && <span className="update-dot" aria-label="Updated since you last looked" />}
        </Link>
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

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'

export interface AppNotification {
  id: number
  user_id: string
  task_id: string | null
  actor_id: string | null
  type: 'assigned' | 'reassigned' | 'status' | 'comment' | 'attachment' | 'updated' | string
  message: string
  read_at: string | null
  created_at: string
}

interface NotificationsState {
  latest: AppNotification[]          // newest 20, for the bell dropdown
  unread: number
  markRead: (id: number) => Promise<void>
  markAllRead: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<NotificationsState | null>(null)

/** Loads the signed-in user's notifications and keeps them live (realtime + 60s fallback poll). */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const userId = profile?.id
  const [latest, setLatest] = useState<AppNotification[]>([])
  const [unread, setUnread] = useState(0)

  const refresh = useCallback(async () => {
    if (!userId) return
    const [list, count] = await Promise.all([
      supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
    ])
    setLatest((list.data as AppNotification[]) ?? [])
    setUnread(count.count ?? 0)
  }, [userId])

  useEffect(() => {
    if (!userId) { setLatest([]); setUnread(0); return }
    refresh()
    const channel = supabase.channel(`notifications-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as AppNotification
          setLatest((l) => [n, ...l.filter((x) => x.id !== n.id)].slice(0, 20))
          setUnread((u) => u + 1)
        })
      .subscribe()
    const timer = window.setInterval(refresh, 60_000)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      supabase.removeChannel(channel)
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [userId, refresh])

  // Unread count in the browser tab title, e.g. "(3) Task Mgnt"
  useEffect(() => {
    document.title = unread > 0 ? `(${unread > 99 ? '99+' : unread}) Task Mgnt` : 'Task Mgnt'
  }, [unread])

  const markRead = async (id: number) => {
    const target = latest.find((n) => n.id === id)
    if (target && target.read_at) return
    const now = new Date().toISOString()
    setLatest((l) => l.map((n) => (n.id === id ? { ...n, read_at: now } : n)))
    setUnread((u) => Math.max(0, u - 1))
    await supabase.from('notifications').update({ read_at: now }).eq('id', id).is('read_at', null)
  }

  const markAllRead = async () => {
    const now = new Date().toISOString()
    setLatest((l) => l.map((n) => ({ ...n, read_at: n.read_at ?? now })))
    setUnread(0)
    if (userId) await supabase.from('notifications').update({ read_at: now }).eq('user_id', userId).is('read_at', null)
  }

  return <Ctx.Provider value={{ latest, unread, markRead, markAllRead, refresh }}>{children}</Ctx.Provider>
}

export function useNotifications() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useNotifications must be used inside <NotificationsProvider>')
  return ctx
}

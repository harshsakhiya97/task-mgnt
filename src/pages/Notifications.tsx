import { PushPrompt } from '../components/PushSettings'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlarmClock, Bell, CheckCheck } from 'lucide-react'
import { SubTabs } from '../components/SubTabs'
import { useAuth } from '../auth/AuthProvider'
import { Pagination } from '../components/Pagination'
import { supabase } from '../lib/supabase'
import { timeAgo } from '../lib/tasks'
import { NotificationIcon } from '../notifications/NotificationIcon'
import { useNotifications, type AppNotification } from '../notifications/NotificationsProvider'

type Kind = 'updates' | 'reminders'

/** Notifications (task updates) and Reminders in two tabs (?tab=reminders). */
export function Notifications() {
  const { latest, markRead, refresh } = useNotifications()
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const kind: Kind = params.get('tab') === 'reminders' ? 'reminders' : 'updates'
  const setKind = (k: Kind) => setParams(k === 'reminders' ? { tab: 'reminders' } : {})
  const [unreadBy, setUnreadBy] = useState<Record<Kind, number>>({ updates: 0, reminders: 0 })
  const unread = unreadBy[kind]
  const navigate = useNavigate()
  const [items, setItems] = useState<AppNotification[]>([])
  const [total, setTotal] = useState(0)
  const [onlyUnread, setOnlyUnread] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    let q = supabase.from('notifications').select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1)
    q = kind === 'reminders' ? q.eq('type', 'reminder') : q.neq('type', 'reminder')
    if (onlyUnread) q = q.is('read_at', null)
    const [{ data, count }, u1, u2] = await Promise.all([
      q,
      supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null).neq('type', 'reminder'),
      supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null).eq('type', 'reminder'),
    ])
    setItems((data as AppNotification[]) ?? [])
    setTotal(count ?? 0)
    setUnreadBy({ updates: u1.count ?? 0, reminders: u2.count ?? 0 })
    setLoading(false)
  }, [page, pageSize, onlyUnread, kind])

  // Reload when filters change or a new notification arrives live.
  useEffect(() => { load() }, [load, latest[0]?.id])
  useEffect(() => { setPage(1) }, [onlyUnread, pageSize, kind])

  const open = (n: AppNotification) => {
    markRead(n.id)
    setUnreadBy((u) => (n.read_at ? u : { ...u, [kind]: Math.max(0, u[kind] - 1) }))
    if (n.task_id) navigate(`/tasks?task=${n.task_id}`)
  }

  // Mark only this tab's items as read.
  const readAll = async () => {
    if (!profile) return
    const q = supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', profile.id).is('read_at', null)
    await (kind === 'reminders' ? q.eq('type', 'reminder') : q.neq('type', 'reminder'))
    await refresh(); load()
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Notifications</h2>
          <p>{kind === 'reminders'
            ? 'Reminders about tasks before their deadline: the ones you set, and automatic ones for urgent and high priority tasks.'
            : 'New tasks, status changes, comments and files on tasks you\'re involved in.'}</p>
        </div>
      </div>
      <SubTabs value={kind} onChange={setKind} options={[
        { value: 'updates', label: 'Notifications', icon: Bell, badge: unreadBy.updates || undefined },
        { value: 'reminders', label: 'Reminders', icon: AlarmClock, badge: unreadBy.reminders || undefined },
      ]} />
      {kind === 'reminders' && <PushPrompt always />}
      <div className="panel">
        <div className="panel-toolbar">
          <div className="view-tabs">
            <button className={!onlyUnread ? 'active' : ''} onClick={() => setOnlyUnread(false)}>All</button>
            <button className={onlyUnread ? 'active' : ''} onClick={() => setOnlyUnread(true)}>
              Unread{unread > 0 && <span className="new-count">{unread}</span>}
            </button>
          </div>
          <span className="spacer" />
          <button className="secondary" disabled={unread === 0} onClick={readAll}><CheckCheck size={16} /> Mark all as read</button>
        </div>
        {loading ? <div className="empty">Loading…</div> : items.length === 0 ? (
          kind === 'reminders'
            ? <div className="empty"><AlarmClock size={40} /><b>{onlyUnread ? 'No unread reminders' : 'No reminders yet'}</b>
                Reminders you or others set on your tasks show up here when they're due.</div>
            : <div className="empty"><Bell size={40} /><b>{onlyUnread ? 'No unread notifications' : 'No notifications yet'}</b>
                You'll be notified when tasks are assigned to you or when someone works on a task you assigned.</div>
        ) : (
          <div className="notif-page-list">
            {items.map((n) => (
              <button key={n.id} className={`notif-item ${n.read_at ? '' : 'unread'}`} onClick={() => open(n)}>
                <NotificationIcon type={n.type} />
                <span className="notif-text">
                  <span>{n.message}</span>
                  <small>{timeAgo(n.created_at)} · {new Date(n.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
                </span>
                {!n.read_at && <span className="notif-dot" aria-label="Unread" />}
              </button>
            ))}
          </div>
        )}
        <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={setPageSize} />
      </div>
    </>
  )
}

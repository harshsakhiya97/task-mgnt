import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck } from 'lucide-react'
import { Pagination } from '../components/Pagination'
import { supabase } from '../lib/supabase'
import { timeAgo } from '../lib/tasks'
import { NotificationIcon } from '../notifications/NotificationIcon'
import { useNotifications, type AppNotification } from '../notifications/NotificationsProvider'

export function Notifications() {
  const { unread, latest, markRead, markAllRead } = useNotifications()
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
    if (onlyUnread) q = q.is('read_at', null)
    const { data, count } = await q
    setItems((data as AppNotification[]) ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [page, pageSize, onlyUnread])

  // Reload when filters change or a new notification arrives live.
  useEffect(() => { load() }, [load, latest[0]?.id])
  useEffect(() => { setPage(1) }, [onlyUnread, pageSize])

  const open = (n: AppNotification) => {
    markRead(n.id)
    if (n.task_id) navigate(`/tasks?task=${n.task_id}`)
  }

  const readAll = async () => { await markAllRead(); load() }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Notifications</h2>
          <p>New tasks, status changes, comments and files on tasks you're involved in.</p>
        </div>
      </div>
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
          <div className="empty"><Bell size={40} /><b>{onlyUnread ? 'No unread notifications' : 'No notifications yet'}</b>
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

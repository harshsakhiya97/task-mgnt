import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck } from 'lucide-react'
import { timeAgo } from '../lib/tasks'
import { NotificationIcon } from './NotificationIcon'
import { useNotifications, type AppNotification } from './NotificationsProvider'

export function NotificationBell() {
  const { latest, unread, markRead, markAllRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const openItem = (n: AppNotification) => {
    markRead(n.id)
    setOpen(false)
    if (n.task_id) navigate(`/tasks?task=${n.task_id}`)
  }

  return (
    <div className="bell-wrap" ref={ref}>
      <button className="icon bell-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} onClick={() => setOpen((o) => !o)}>
        <Bell size={22} />
        {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <h3>Notifications</h3>
            {unread > 0 && <button className="link" onClick={markAllRead}><CheckCheck size={15} /> Mark all as read</button>}
          </div>
          <div className="bell-list">
            {latest.length === 0 ? (
              <div className="empty"><Bell size={34} /><b>You're all caught up</b>No notifications yet.</div>
            ) : latest.map((n) => (
              <button key={n.id} className={`notif-item ${n.read_at ? '' : 'unread'}`} onClick={() => openItem(n)}>
                <NotificationIcon type={n.type} />
                <span className="notif-text">
                  <span>{n.message}</span>
                  <small>{timeAgo(n.created_at)}</small>
                </span>
                {!n.read_at && <span className="notif-dot" aria-label="Unread" />}
              </button>
            ))}
          </div>
          <button className="bell-foot" onClick={() => { setOpen(false); navigate('/notifications') }}>View all notifications</button>
        </div>
      )}
    </div>
  )
}

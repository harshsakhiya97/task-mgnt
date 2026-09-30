import { useEffect, useState } from 'react'
import { Bug, Minus, Sparkles, TrendingUp } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { RELEASES, type ChangeType } from '../lib/changelog'
import { APP_VERSION, markUpdateSeen } from '../lib/version'

const TYPE: Record<ChangeType, { label: string; Icon: typeof Sparkles; tone: string }> = {
  new: { label: 'New', Icon: Sparkles, tone: 'wn-new' },
  improved: { label: 'Improved', Icon: TrendingUp, tone: 'wn-improved' },
  fixed: { label: 'Fixed', Icon: Bug, tone: 'wn-fixed' },
  removed: { label: 'Removed', Icon: Minus, tone: 'wn-removed' },
}
const ORDER: ChangeType[] = ['new', 'improved', 'fixed', 'removed']

const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
const current = (v: string) => APP_VERSION === v || APP_VERSION === `${v}.0`

/** Everyone: what changed in each version, newest first. Admin-only features carry an "Admin" tag. */
export function WhatsNew() {
  const { profile } = useAuth()
  const [adminOnly, setAdminOnly] = useState<'all' | 'team'>('all')
  useEffect(() => { markUpdateSeen() }, [])
  const isAdmin = profile?.role === 'admin'

  return (
    <>
      <div className="page-head">
        <div>
          <h2>What's New</h2>
          <p>Every version of Task Mgnt and what it added. Features marked <span className="wn-admin">Admin</span> are only visible to admins.</p>
        </div>
        {isAdmin && (
          <div className="segmented wn-filter">
            <button className={adminOnly === 'all' ? 'on' : ''} onClick={() => setAdminOnly('all')}>All changes</button>
            <button className={adminOnly === 'team' ? 'on' : ''} onClick={() => setAdminOnly('team')}>What team members see</button>
          </div>
        )}
      </div>

      <div className="wn-timeline">
        {RELEASES.map((r) => {
          const changes = r.changes.filter((c) => adminOnly === 'all' || !c.admin)
          if (!changes.length) return null
          return (
            <section key={r.version} className="wn-release">
              <div className="wn-rail"><span className="wn-dot" /></div>
              <div className="panel wn-card">
                <div className="wn-head">
                  <span className="wn-version">Version {r.version}</span>
                  {current(r.version) && <span className="badge active">Current</span>}
                  <span className="muted small">{fmt(r.date)}</span>
                </div>
                <h3>{r.title}</h3>
                <p className="muted">{r.summary}</p>
                {ORDER.map((t) => {
                  const list = changes.filter((c) => c.type === t)
                  if (!list.length) return null
                  const { label, Icon, tone } = TYPE[t]
                  return (
                    <div key={t} className="wn-group">
                      <div className={`wn-type ${tone}`}><Icon size={14} /> {label}</div>
                      <ul>
                        {list.map((c, i) => (
                          <li key={i}>{c.text}{c.admin && <span className="wn-admin">Admin</span>}</li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </>
  )
}

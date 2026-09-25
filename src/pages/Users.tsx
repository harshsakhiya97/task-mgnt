import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { KeyRound, Pencil, Plus, Search, UserCheck, Users as UsersIcon, UserX } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Drawer } from '../components/Drawer'
import { Field } from '../components/Fields'
import { Pagination } from '../components/Pagination'
import { adminUsers } from '../lib/adminApi'
import { initials } from '../lib/initials'
import { supabase } from '../lib/supabase'
import { roleBadge, type Profile, type RoleRow, type Team } from '../lib/types'
import { RolesPanel } from './Roles'
import { TeamsPanel } from './Teams'

type Panel = { mode: 'create' } | { mode: 'edit'; user: Profile } | { mode: 'password'; user: Profile }

type UTab = 'users' | 'roles' | 'teams'
const TAB_LABELS: Record<UTab, string> = { users: 'Users', roles: 'Roles', teams: 'Teams' }
const TAB_INTRO: Record<UTab, string> = {
  users: 'Add people, set their role and team, and control who can log in.',
  roles: 'The list of roles you can give people. Add, rename or remove roles.',
  teams: 'Group people into teams, e.g. TVS.',
}

/** Users & Roles: Users / Roles (master) / Teams (master) tabs. */
export function Users() {
  const [params, setParams] = useSearchParams()
  const t = params.get('tab')
  const tab: UTab = t === 'roles' || t === 'teams' ? t : 'users'
  // The tabs sit in each panel's search row.
  const tabs = (
    <div className="view-tabs">
      {(['users', 'roles', 'teams'] as UTab[]).map((v) => (
        <button key={v} className={tab === v ? 'active' : ''} onClick={() => setParams(v === 'users' ? {} : { tab: v })}>{TAB_LABELS[v]}</button>
      ))}
    </div>
  )
  return (
    <>
      <div className="page-head">
        <div>
          <h2>Users Management</h2>
          <p>{TAB_INTRO[tab]}</p>
        </div>
      </div>
      {tab === 'users' ? <UsersPanel tabs={tabs} /> : tab === 'roles' ? <RolesPanel tabs={tabs} /> : <TeamsPanel tabs={tabs} />}
    </>
  )
}

function UsersPanel({ tabs }: { tabs: ReactNode }) {
  const { profile: me } = useAuth()
  const [users, setUsers] = useState<Profile[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active')
  const [panel, setPanel] = useState<Panel | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [toggling, setToggling] = useState<Profile | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [u, t, r] = await Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('teams').select('id, name').order('name'),
      supabase.from('roles').select('id, name, description, is_admin, is_system').order('is_admin', { ascending: false }).order('name'),
    ])
    if (u.error) setError(u.error.message)
    setUsers((u.data as Profile[]) ?? [])
    setTeams((t.data as Team[]) ?? [])
    setRoles((r.data as RoleRow[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const teamName = useMemo(() => Object.fromEntries(teams.map((t) => [t.id, t.name])), [teams])
  const roleById = useMemo(() => Object.fromEntries(roles.map((r) => [r.id, r])), [roles])

  const visible = users.filter((u) => {
    if (statusFilter === 'active' && !u.is_active) return false
    if (statusFilter === 'inactive' && u.is_active) return false
    if (roleFilter && u.role_id !== roleFilter) return false
    if (teamFilter && u.team_id !== teamFilter) return false
    const q = search.trim().toLowerCase()
    return !q || [u.full_name, u.email, u.phone ?? ''].some((v) => v.toLowerCase().includes(q))
  })

  // Back to page 1 whenever the filters change; keep the page valid if rows disappear.
  useEffect(() => { setPage(1) }, [search, roleFilter, teamFilter, statusFilter, pageSize])
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize))
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])
  const pageRows = visible.slice((page - 1) * pageSize, page * pageSize)
  const offset = (page - 1) * pageSize

  const confirmToggle = async () => {
    if (!toggling) return
    setBusy(true)
    try {
      await adminUsers({ action: 'set_active', id: toggling.id, active: !toggling.is_active })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false); setToggling(null)
    }
  }

  return (
    <>
      {error && <div className="alert error" onClick={() => setError('')}>{error}</div>}

      <div className="panel">
        <div className="panel-toolbar">
          {tabs}
          <span className="count-pill">{visible.length} Users</span>
          <span className="spacer" />
          <div className="search-box">
            <Search size={16} />
            <input placeholder="Search name, email, phone" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button onClick={() => setPanel({ mode: 'create' })}><Plus size={18} /> Add User</button>
        </div>
        <div className="filters">
          <select className="pill-select" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">Select Role</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select className="pill-select" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
            <option value="">Select Team</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className="pill-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
            <option value="active">Active Users</option>
            <option value="inactive">Inactive Users</option>
            <option value="all">All Users</option>
          </select>
        </div>
        <div className="table-scroll">
          {loading ? <div className="empty">Loading…</div> : visible.length === 0 ? (
            <div className="empty"><UsersIcon size={40} /><b>No users found</b>Try changing the filters, or add a new user.</div>
          ) : (
            <table>
              <thead>
                <tr><th>Sr. No.</th><th>Name</th><th>Email ID</th><th>Phone</th><th>Role</th><th>Team</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {pageRows.map((u, i) => (
                  <tr key={u.id} className={u.is_active ? '' : 'inactive'}>
                    <td>{offset + i + 1}</td>
                    <td>
                      <div className="user-cell">
                        <div className="avatar">{initials(u.full_name)}</div>
                        <span>{u.full_name}{u.id === me?.id && <span className="tag">you</span>}</span>
                      </div>
                    </td>
                    <td>{u.email}</td>
                    <td>{u.phone ?? '—'}</td>
                    <td><span className={`badge ${roleBadge(roleById[u.role_id])}`}>{roleById[u.role_id]?.name ?? '—'}</span></td>
                    <td>{u.team_id ? teamName[u.team_id] ?? '—' : '—'}</td>
                    <td><span className={`badge ${u.is_active ? 'active' : 'inactive'}`}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td className="actions">
                      <button className="icon" title="Edit" onClick={() => setPanel({ mode: 'edit', user: u })}><Pencil size={17} /></button>
                      <button className="icon" title="Set password" onClick={() => setPanel({ mode: 'password', user: u })}><KeyRound size={17} /></button>
                      {u.id !== me?.id && (
                        <button className="icon" title={u.is_active ? 'Deactivate' : 'Reactivate'} onClick={() => setToggling(u)}>
                          {u.is_active ? <UserX size={17} /> : <UserCheck size={17} />}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Pagination page={page} pageSize={pageSize} total={visible.length} onPage={setPage} onPageSize={setPageSize} />
      </div>

      {panel?.mode === 'create' && <UserDrawer teams={teams} roles={roles} onClose={() => setPanel(null)} onSaved={() => { setPanel(null); load() }} />}
      {panel?.mode === 'edit' && (
        <UserDrawer user={panel.user} isSelf={panel.user.id === me?.id} teams={teams} roles={roles}
          onClose={() => setPanel(null)} onSaved={() => { setPanel(null); load() }} />
      )}
      {panel?.mode === 'password' && <PasswordDrawer user={panel.user} onClose={() => setPanel(null)} />}

      {toggling && (
        <ConfirmDialog
          icon={toggling.is_active ? <UserX size={30} /> : <UserCheck size={30} />}
          tone={toggling.is_active ? 'danger' : 'info'}
          title={toggling.is_active ? `Deactivate ${toggling.full_name}?` : `Reactivate ${toggling.full_name}?`}
          message={toggling.is_active ? 'They will be logged out and will not be able to log in.' : 'They will be able to log in again.'}
          confirmLabel={toggling.is_active ? 'Yes, Deactivate' : 'Yes, Reactivate'}
          busy={busy}
          onConfirm={confirmToggle}
          onCancel={() => setToggling(null)}
        />
      )}
    </>
  )
}

function UserDrawer({ user, isSelf, teams, roles, onClose, onSaved }: {
  user?: Profile; isSelf?: boolean; teams: Team[]; roles: RoleRow[]; onClose: () => void; onSaved: () => void
}) {
  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [roleId, setRoleId] = useState(user?.role_id ?? roles.find((r) => r.name === 'Team Member')?.id ?? roles.find((r) => !r.is_admin)?.id ?? '')
  const [teamId, setTeamId] = useState(user?.team_id ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setError(''); setBusy(true)
    try {
      if (user) {
        await adminUsers({
          action: 'update', id: user.id, full_name: fullName, phone, role_id: roleId, team_id: teamId || null,
          ...(email.trim().toLowerCase() !== user.email ? { email } : {}),
        })
      } else {
        await adminUsers({ action: 'create', full_name: fullName, email, phone, role_id: roleId, team_id: teamId || null, password })
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer title={user ? `Edit User – ${user.full_name}` : 'Add User'} onClose={onClose} onSubmit={submit}
      submitLabel={user ? 'Update' : 'Create User'} busy={busy}>
      <div className="form-section">User Details</div>
      <Field label="Full Name" required>
        <input required placeholder="Enter Here" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </Field>
      <div className="form-grid">
        <Field label="Email ID" required>
          <input type="email" required placeholder="Enter Here" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Phone Number (WhatsApp)">
          <input placeholder="+91…" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
      </div>
      <div className="form-section">Access</div>
      <div className="form-grid">
        <Field label="Role" required hint={isSelf ? "You can't change your own role." : undefined}>
          <select required value={roleId} disabled={isSelf} onChange={(e) => setRoleId(e.target.value)}>
            <option value="" disabled>Select Role</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}{r.is_admin ? ' (full access)' : ''}</option>)}
          </select>
        </Field>
        <Field label="Team">
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">Select Team</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
      </div>
      {!user && (
        <Field label="Temporary Password" required hint="At least 8 characters. Share it with the user; they can change it from My Profile.">
          <input type="text" required minLength={8} placeholder="Enter Here" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      )}
      {error && <div className="alert error">{error}</div>}
    </Drawer>
  )
}

function PasswordDrawer({ user, onClose }: { user: Profile; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setError(''); setBusy(true)
    try {
      await adminUsers({ action: 'set_password', id: user.id, password })
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer title={`Set Password – ${user.full_name}`} onClose={onClose} onSubmit={submit}
      submitLabel="Set Password" busy={busy} hideSubmit={done}>
      {done ? (
        <div className="alert ok">Password updated. Share the new password with {user.full_name}.</div>
      ) : (
        <>
          <Field label="New Password" required hint="At least 8 characters.">
            <input type="text" required minLength={8} placeholder="Enter Here" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <div className="alert error">{error}</div>}
        </>
      )}
    </Drawer>
  )
}

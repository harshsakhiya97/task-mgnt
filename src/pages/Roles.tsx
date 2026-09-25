import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Lock, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Drawer } from '../components/Drawer'
import { Field } from '../components/Fields'
import { supabase } from '../lib/supabase'
import { roleBadge, type RoleRow } from '../lib/types'

/** Roles master (Users & Roles → Roles tab). Only the built-in Admin role has admin access. */
export function RolesPanel({ tabs, onChanged }: { tabs?: ReactNode; onChanged?: () => void }) {
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<RoleRow | 'new' | null>(null)
  const [deleting, setDeleting] = useState<RoleRow | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [r, p] = await Promise.all([
      supabase.from('roles').select('id, name, description, is_admin, is_system').order('is_admin', { ascending: false }).order('name'),
      supabase.from('profiles').select('role_id, is_active'),
    ])
    if (r.error) setError(r.error.message)
    setRoles((r.data as RoleRow[]) ?? [])
    const c: Record<string, number> = {}
    for (const row of (p.data ?? []) as { role_id: string; is_active: boolean }[]) c[row.role_id] = (c[row.role_id] ?? 0) + 1
    setCounts(c)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const saved = () => { setEditing(null); load(); onChanged?.() }

  const remove = async () => {
    if (!deleting) return
    const { error } = await supabase.from('roles').delete().eq('id', deleting.id)
    setDeleting(null)
    if (error) return setError(error.message)
    load(); onChanged?.()
  }

  return (
    <>
      {error && <div className="alert error" onClick={() => setError('')}>{error}</div>}
      <div className="panel">
        <div className="panel-toolbar">
          {tabs ?? <span className="tab-chip"><ShieldCheck size={18} /> Roles</span>}
          <span className="count-pill">{roles.length} Roles</span>
          <span className="spacer" />
          <button onClick={() => setEditing('new')}><Plus size={18} /> Add Role</button>
        </div>
        <div className="table-scroll">
          {loading ? <div className="empty">Loading…</div> : (
            <table>
              <thead><tr><th>Sr. No.</th><th>Role Name</th><th>Description</th><th>Access</th><th>Users</th><th></th></tr></thead>
              <tbody>
                {roles.map((r, i) => (
                  <tr key={r.id}>
                    <td>{i + 1}</td>
                    <td><span className={`badge ${roleBadge(r)}`}>{r.name}</span>{r.is_system && <span className="tag" title="Built-in role"><Lock size={11} /> built-in</span>}</td>
                    <td className="muted">{r.description || '—'}</td>
                    <td>{r.is_admin ? 'Full admin access' : 'Standard'}</td>
                    <td><span className="count-pill">{counts[r.id] ?? 0}</span></td>
                    <td className="actions">
                      <button className="icon" title="Edit" onClick={() => setEditing(r)}><Pencil size={17} /></button>
                      {!r.is_system && (
                        <button className="icon" title={counts[r.id] ? 'In use – move its users to another role first' : 'Delete'}
                          disabled={!!counts[r.id]} onClick={() => setDeleting(r)}><Trash2 size={17} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <p className="muted small-note">Only the built-in <b>Admin</b> role can manage users, roles and teams and see every task. Every other role is a label with standard access.</p>

      {editing && <RoleDrawer role={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={saved} />}
      {deleting && (
        <ConfirmDialog icon={<Trash2 size={30} />} title={`Delete "${deleting.name}"?`} message="This cannot be undone."
          confirmLabel="Yes, Delete" onConfirm={remove} onCancel={() => setDeleting(null)} />
      )}
    </>
  )
}

function RoleDrawer({ role, onClose, onSaved }: { role?: RoleRow; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(role?.name ?? '')
  const [description, setDescription] = useState(role?.description ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lockedName = !!role?.is_admin

  const submit = async () => {
    setError(''); setBusy(true)
    const row = { name: name.trim(), description: description.trim() || null }
    const { error } = role
      ? await supabase.from('roles').update(row).eq('id', role.id)
      : await supabase.from('roles').insert(row)
    setBusy(false)
    if (error) return setError(error.code === '23505' ? 'A role with this name already exists' : error.message)
    onSaved()
  }

  return (
    <Drawer title={role ? `Edit Role – ${role.name}` : 'Add Role'} onClose={onClose} onSubmit={submit}
      submitLabel={role ? 'Update' : 'Create Role'} busy={busy}>
      <Field label="Role Name" required hint={lockedName ? 'The Admin role cannot be renamed.' : undefined}>
        <input required autoFocus={!lockedName} disabled={lockedName} placeholder="e.g. Coordinator" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Description">
        <textarea rows={3} placeholder="What this role does (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      {!role?.is_admin && <div className="alert info">New roles have standard access (same as Team Member).</div>}
      {error && <div className="alert error">{error}</div>}
    </Drawer>
  )
}

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Pencil, Plus, Trash2, UsersRound } from 'lucide-react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Drawer } from '../components/Drawer'
import { Field } from '../components/Fields'
import { supabase } from '../lib/supabase'
import type { Team } from '../lib/types'

/** Teams master (Users & Roles → Teams tab). */
export function TeamsPanel({ tabs }: { tabs?: ReactNode }) {
  const [teams, setTeams] = useState<Team[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Team | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Team | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [t, p] = await Promise.all([
      supabase.from('teams').select('id, name').order('name'),
      supabase.from('profiles').select('team_id').eq('is_active', true),
    ])
    if (t.error) setError(t.error.message)
    setTeams((t.data as Team[]) ?? [])
    const c: Record<string, number> = {}
    for (const row of (p.data ?? []) as { team_id: string | null }[]) {
      if (row.team_id) c[row.team_id] = (c[row.team_id] ?? 0) + 1
    }
    setCounts(c)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const remove = async () => {
    if (!deleting) return
    const { error } = await supabase.from('teams').delete().eq('id', deleting.id)
    setDeleting(null)
    if (error) return setError(error.message)
    load()
  }

  return (
    <>
      {error && <div className="alert error" onClick={() => setError('')}>{error}</div>}

      <div className="panel">
        <div className="panel-toolbar">
          {tabs ?? <span className="tab-chip"><UsersRound size={18} /> Teams</span>}
          <span className="count-pill">{teams.length} Teams</span>
          <span className="spacer" />
          <button onClick={() => setEditing('new')}><Plus size={18} /> Add Team</button>
        </div>
        <div className="table-scroll">
          {loading ? <div className="empty">Loading…</div> : teams.length === 0 ? (
            <div className="empty"><UsersRound size={40} /><b>No teams yet</b>Add your first team to get started.</div>
          ) : (
            <table>
              <thead><tr><th>Sr. No.</th><th>Team Name</th><th>Active Members</th><th></th></tr></thead>
              <tbody>
                {teams.map((t, i) => (
                  <tr key={t.id}>
                    <td>{i + 1}</td>
                    <td>{t.name}</td>
                    <td><span className="count-pill">{counts[t.id] ?? 0}</span></td>
                    <td className="actions">
                      <button className="icon" title="Rename" onClick={() => setEditing(t)}><Pencil size={17} /></button>
                      <button className="icon" title="Delete" onClick={() => setDeleting(t)}><Trash2 size={17} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {editing && <TeamDrawer team={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
      {deleting && (
        <ConfirmDialog
          icon={<Trash2 size={30} />}
          title={`Delete "${deleting.name}"?`}
          message={counts[deleting.id] ? `${counts[deleting.id]} member(s) will be left without a team.` : 'This cannot be undone.'}
          confirmLabel="Yes, Delete"
          onConfirm={remove}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  )
}

function TeamDrawer({ team, onClose, onSaved }: { team?: Team; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(team?.name ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setError(''); setBusy(true)
    const { error } = team
      ? await supabase.from('teams').update({ name: name.trim() }).eq('id', team.id)
      : await supabase.from('teams').insert({ name: name.trim() })
    setBusy(false)
    if (error) return setError(error.code === '23505' ? 'A team with this name already exists' : error.message)
    onSaved()
  }

  return (
    <Drawer title={team ? 'Rename Team' : 'Add Team'} onClose={onClose} onSubmit={submit} submitLabel={team ? 'Update' : 'Create Team'} busy={busy}>
      <Field label="Team Name" required>
        <input required autoFocus placeholder="e.g. TVS" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {error && <div className="alert error">{error}</div>}
    </Drawer>
  )
}

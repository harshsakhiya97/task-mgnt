import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { Field } from '../components/Fields'
import { LogoutDialog } from '../components/LogoutDialog'
import { initials } from '../lib/initials'
import { supabase } from '../lib/supabase'
import { roleBadge, type Team } from '../lib/types'

type Tab = 'profile' | 'password'

/** Settings page with its own sub-menu: My Profile, Reset Password, Logout. */
export function Profile() {
  const [tab, setTab] = useState<Tab>('profile')
  const [confirmLogout, setConfirmLogout] = useState(false)

  return (
    <div className="settings">
      <div className="settings-nav">
        <div className="nav-section">Settings</div>
        <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>My Profile</button>
        <button className={tab === 'password' ? 'active' : ''} onClick={() => setTab('password')}>Reset Password</button>
        <button onClick={() => setConfirmLogout(true)}>Logout</button>
      </div>
      <div className="settings-body">
        {tab === 'profile' ? <MyProfile /> : <ChangePassword />}
      </div>
      {confirmLogout && <LogoutDialog onCancel={() => setConfirmLogout(false)} />}
    </div>
  )
}

function MyProfile() {
  const { profile, refreshProfile } = useAuth()
  const [team, setTeam] = useState<Team | null>(null)
  const [editing, setEditing] = useState(false)
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!profile) return
    setFullName(profile.full_name); setPhone(profile.phone ?? '')
    if (profile.team_id) {
      supabase.from('teams').select('id, name').eq('id', profile.team_id).maybeSingle().then(({ data }) => setTeam(data as Team | null))
    }
  }, [profile])

  if (!profile) return null

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const { error } = await supabase.from('profiles')
      .update({ full_name: fullName.trim(), phone: phone.trim() || null }).eq('id', profile.id)
    if (error) return setMsg({ ok: false, text: error.message })
    await refreshProfile()
    setEditing(false)
    setMsg({ ok: true, text: 'Profile updated' })
  }

  return (
    <>
      <h2>My Profile</h2>
      <div className="profile-top">
        <div className="avatar xl">{initials(profile.full_name)}</div>
      </div>
      {editing ? (
        <form className="narrow-form" onSubmit={save}>
          <Field label="User Name" required><input required value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
          <Field label="Phone Number (WhatsApp)"><input placeholder="+91…" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <div className="row" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="secondary" onClick={() => setEditing(false)}>Cancel</button>
            <button type="submit">Save</button>
          </div>
        </form>
      ) : (
        <>
          <dl className="kv">
            <dt>User Name</dt><dd>{profile.full_name}</dd>
            <dt>Email ID</dt><dd>{profile.email}</dd>
            <dt>Phone Number</dt><dd>{profile.phone ?? '—'}</dd>
            <dt>My Role</dt><dd><span className={`badge ${roleBadge(profile.role_info)}`}>{profile.role_info?.name ?? '—'}</span></dd>
            <dt>Team</dt><dd>{team?.name ?? '—'}</dd>
          </dl>
          {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
          <button onClick={() => { setMsg(null); setEditing(true) }}>Edit Profile</button>
        </>
      )}
    </>
  )
}

function ChangePassword() {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (pw.length < 8) return setMsg({ ok: false, text: 'Password must be at least 8 characters' })
    if (pw !== pw2) return setMsg({ ok: false, text: 'Passwords do not match' })
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return setMsg({ ok: false, text: error.message })
    setPw(''); setPw2('')
    setMsg({ ok: true, text: 'Password changed' })
  }

  return (
    <form className="narrow-form" onSubmit={submit}>
      <h2 style={{ marginBottom: 20 }}>Reset Password</h2>
      <Field label="New Password" required><input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      <Field label="Confirm Password" required><input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
      <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Update Password'}</button>
    </form>
  )
}

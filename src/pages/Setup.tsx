import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { Mail, UserRound } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { AuthLayout } from '../components/AuthLayout'
import { IconInput, PasswordInput } from '../components/Fields'
import { supabase } from '../lib/supabase'

/** Asks the setup-admin function whether the app still has no users. */
export async function needsFirstAdmin(): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke('setup-admin', { body: { action: 'status' } })
  return !error && Boolean(data?.needsSetup)
}

export function Setup() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState<'checking' | 'open' | 'done'>('checking')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    needsFirstAdmin().then((open) => setStatus(open ? 'open' : 'done'))
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) return setError('Password must be at least 8 characters')
    if (password !== confirm) return setError('Passwords do not match')
    setBusy(true)
    try {
      const { error } = await supabase.functions.invoke('setup-admin', {
        body: { action: 'create', full_name: fullName, email, password },
      })
      if (error) {
        const detail = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null
        throw new Error(detail?.error ?? error.message)
      }
      await signIn(email, password)
      navigate('/users', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (status === 'checking') return <div className="center">Loading…</div>

  if (status === 'done') {
    return (
      <AuthLayout>
        <div className="auth-title">Setup complete</div>
        <p className="auth-sub">An admin already exists. Log in, or ask your admin to add you.</p>
        <Link to="/login" className="auth-back">Go to login</Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <form onSubmit={submit}>
        <div className="auth-title">Create admin account</div>
        <p className="auth-sub">First-time setup. This screen is shown only once.</p>
        <IconInput icon={<UserRound size={20} />} label="Your Name" required placeholder="Enter your name"
          value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <IconInput icon={<Mail size={20} />} label="Email ID" type="email" required autoComplete="email"
          placeholder="Used to log in" value={email} onChange={(e) => setEmail(e.target.value)} />
        <PasswordInput label="Password" required autoComplete="new-password" placeholder="At least 8 characters"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <PasswordInput label="Confirm Password" required autoComplete="new-password" placeholder="Re-enter password"
          value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {error && <div className="alert error">{error}</div>}
        <button type="submit" className="block" disabled={busy}>{busy ? 'Creating…' : 'Create admin account'}</button>
      </form>
    </AuthLayout>
  )
}

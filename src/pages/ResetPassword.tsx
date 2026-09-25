import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { AuthLayout } from '../components/AuthLayout'
import { PasswordInput } from '../components/Fields'
import { supabase } from '../lib/supabase'

export function ResetPassword() {
  const { session, loading, clearRecovering } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (loading) return <div className="center">Loading…</div>

  if (!session) {
    return (
      <AuthLayout>
        <div className="auth-title">Link expired</div>
        <p className="auth-sub">This reset link is invalid or has expired. Please request a new one.</p>
        <Link to="/forgot-password" className="auth-back">Send a new link</Link>
      </AuthLayout>
    )
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) return setError('Password must be at least 8 characters')
    if (password !== confirm) return setError('Passwords do not match')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setError(error.message)
    clearRecovering()
    navigate('/', { replace: true })
  }

  return (
    <AuthLayout>
      <form onSubmit={submit}>
        <div className="auth-title">Set a new password</div>
        <p className="auth-sub">Choose a password with at least 8 characters.</p>
        <PasswordInput label="New Password" required autoComplete="new-password" placeholder="Enter new password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <PasswordInput label="Confirm Password" required autoComplete="new-password" placeholder="Re-enter new password"
          value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {error && <div className="alert error">{error}</div>}
        <button type="submit" className="block" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
      </form>
    </AuthLayout>
  )
}

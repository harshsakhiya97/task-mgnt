import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { AuthLayout } from '../components/AuthLayout'
import { IconInput, PasswordInput } from '../components/Fields'
import { isConfigured } from '../lib/supabase'
import { needsFirstAdmin } from './Setup'

export function Login() {
  const { session, signIn, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Brand-new installation with no users yet -> first-admin setup screen.
  useEffect(() => {
    if (isConfigured) needsFirstAdmin().then((open) => { if (open) navigate('/setup', { replace: true }) })
  }, [navigate])

  if (!loading && session) return <Navigate to={from} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      await signIn(email, password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <form onSubmit={submit}>
        <div className="auth-title">Log in to your account</div>
        <p className="auth-sub">Welcome! Please enter your details.</p>
        {!isConfigured && <div className="alert error">Supabase keys are missing in .env</div>}
        <IconInput icon={<Mail size={20} />} label="Email ID" type="email" required autoComplete="email"
          placeholder="Enter Email ID" value={email} onChange={(e) => setEmail(e.target.value)} />
        <PasswordInput label="Password" required autoComplete="current-password"
          placeholder="Enter Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="auth-row"><Link to="/forgot-password">Forgot Password?</Link></div>
        {error && <div className="alert error">{error}</div>}
        <button type="submit" className="block" disabled={busy}>{busy ? 'Logging in…' : 'Login'}</button>
      </form>
    </AuthLayout>
  )
}

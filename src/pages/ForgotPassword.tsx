import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { AuthLayout } from '../components/AuthLayout'
import { IconInput } from '../components/Fields'
import { supabase } from '../lib/supabase'

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(''); setBusy(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setBusy(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <AuthLayout>
      <form onSubmit={submit}>
        <div className="auth-title">Forgot password?</div>
        {sent ? (
          <p className="auth-sub">If an account exists for <b>{email}</b>, a reset link has been sent. Check your inbox (and spam).</p>
        ) : (
          <>
            <p className="auth-sub">Enter your email and we'll send you a link to set a new password.</p>
            <IconInput icon={<Mail size={20} />} label="Email ID" type="email" required
              placeholder="Enter Email ID" value={email} onChange={(e) => setEmail(e.target.value)} />
            {error && <div className="alert error">{error}</div>}
            <button type="submit" className="block" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
          </>
        )}
        <Link to="/login" className="auth-back">Back to login</Link>
      </form>
    </AuthLayout>
  )
}

import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import type { Role } from '../lib/types'
import { AuthLayout } from './AuthLayout'

export function RequireAuth({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { session, profile, loading, recovering, signOut } = useAuth()
  const location = useLocation()

  if (loading) return <div className="center">Loading…</div>
  if (recovering) return <Navigate to="/reset-password" replace />
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (!profile) {
    return (
      <AuthLayout>
        <div className="auth-title">Account not set up</div>
        <p className="auth-sub">You're logged in, but this account has no profile or has been deactivated. Ask an admin to add you.</p>
        <button className="block secondary" onClick={signOut}>Back to login</button>
      </AuthLayout>
    )
  }
  if (roles && !roles.includes(profile.role)) return <Navigate to="/" replace />
  return <>{children}</>
}

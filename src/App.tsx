import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { RequireAuth } from './components/RequireAuth'
import { ForgotPassword } from './pages/ForgotPassword'
import { Home } from './pages/Home'
import { Login } from './pages/Login'
import { Notifications } from './pages/Notifications'
import { Profile } from './pages/Profile'
import { ResetPassword } from './pages/ResetPassword'
import { Setup } from './pages/Setup'
import { Tasks } from './pages/Tasks'
import { Reports } from './pages/Reports'
import { Users } from './pages/Users'
import { Settings } from './pages/Settings'
import { WhatsNew } from './pages/WhatsNew'

// The calendar library is large, so it's only downloaded when the Calendar page is opened.
const Calendar = lazy(() => import('./pages/Calendar').then((m) => ({ default: m.Calendar })))

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/setup" element={<Setup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route path="/" element={<Home />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/calendar" element={<Suspense fallback={<div className="center">Loading calendar…</div>}><Calendar /></Suspense>} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/whats-new" element={<WhatsNew />} />
        <Route path="/reports" element={<RequireAuth roles={['admin']}><Reports /></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth roles={['admin']}><Settings /></RequireAuth>} />
        {/* old addresses → Settings tabs */}
        <Route path="/perisclaw" element={<Navigate to="/settings" replace />} />
        <Route path="/whatsapp-logs" element={<Navigate to="/settings?tab=whatsapp" replace />} />
        <Route path="/health" element={<Navigate to="/settings" replace />} />
        <Route path="/users" element={<RequireAuth roles={['admin']}><Users /></RequireAuth>} />
        <Route path="/teams" element={<Navigate to="/users?tab=teams" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

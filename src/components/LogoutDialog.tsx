import { LogOut } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { ConfirmDialog } from './ConfirmDialog'

export function LogoutDialog({ onCancel }: { onCancel: () => void }) {
  const { signOut } = useAuth()
  return (
    <ConfirmDialog
      icon={<LogOut size={30} />}
      title="Ready to leave?"
      message="Are you sure you want to log out?"
      confirmLabel="Yes, Logout"
      onConfirm={signOut}
      onCancel={onCancel}
    />
  )
}

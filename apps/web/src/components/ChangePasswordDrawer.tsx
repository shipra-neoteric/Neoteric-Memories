import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { Drawer } from './ui/Drawer'
import { Button } from './ui/Button'
import { Input, Label, FieldError } from './ui/Input'
import { apiFetch, ApiError } from '../lib/api'
import { toastSuccess } from '../lib/toast'

interface ChangePasswordDrawerProps {
  open: boolean
  onClose: () => void
  /** Called after a successful change — the server revokes every session (including
   * this one), so the caller must log the user out and send them back to /login. */
  onChanged: () => void
}

export function ChangePasswordDrawer({ open, onClose, onChanged }: ChangePasswordDrawerProps) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function reset() {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setError(null)
  }

  async function submit() {
    setError(null)
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match')
      return
    }
    setSubmitting(true)
    try {
      await apiFetch('/api/admin/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } })
      toastSuccess('Password changed — please sign in again')
      reset()
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to change password')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title="Change password"
      subtitle="Any length or character combination is accepted."
      icon={<KeyRound className="w-5 h-5 text-white" />}
    >
      <div className="space-y-4">
        {error && <FieldError>{error}</FieldError>}
        <div>
          <Label required>Current password</Label>
          <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
        </div>
        <div>
          <Label required>New password</Label>
          <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
        </div>
        <div>
          <Label required>Confirm new password</Label>
          <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
        </div>
      </div>
      <div className="pt-2 flex justify-end gap-3">
        <Button
          variant="secondary"
          onClick={() => {
            reset()
            onClose()
          }}
        >
          Cancel
        </Button>
        <Button variant="primary" loading={submitting} onClick={submit} disabled={!currentPassword || !newPassword || !confirmPassword}>
          Change password
        </Button>
      </div>
    </Drawer>
  )
}

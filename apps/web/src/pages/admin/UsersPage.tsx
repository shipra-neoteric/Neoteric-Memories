import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Users as UsersIcon, Plus, Check } from 'lucide-react'
import { ROLES, type Role } from '@neoteric-memories/shared'
import { apiFetch, ApiError } from '../../lib/api'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Drawer } from '../../components/ui/Drawer'
import { Input, Label, FieldError } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { EmptyState, PageSpinner } from '../../components/ui/EmptyState'
import { toastSuccess } from '../../lib/toast'

interface AdminUser {
  id: string
  name: string
  email: string
  role: Role
  isActive: boolean
}
interface Site {
  id: string
  name: string
}

const ROLE_LABEL: Record<Role, string> = {
  MASTER_ADMIN: 'Master Admin',
  MARKETING_HEAD: 'Marketing Head',
  EVENT_MANAGER: 'Event Manager',
  PHOTOGRAPHER: 'Photographer',
  SUPPORT_EXECUTIVE: 'Support Executive',
}

export function UsersPage() {
  const queryClient = useQueryClient()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('EVENT_MANAGER')
  const [siteIds, setSiteIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['users'], queryFn: () => apiFetch<{ users: AdminUser[] }>('/api/admin/users') })
  const { data: sitesData } = useQuery({ queryKey: ['sites'], queryFn: () => apiFetch<{ sites: Site[] }>('/api/admin/sites') })

  const createUser = useMutation({
    mutationFn: () => apiFetch('/api/admin/users', { method: 'POST', body: { name, email, password, role, siteIds, isActive: true } }),
    onSuccess: () => {
      toastSuccess('User created')
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setDrawerOpen(false)
      setName('')
      setEmail('')
      setPassword('')
      setSiteIds([])
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to create user'),
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Users</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Team members and their roles.</p>
        </div>
        <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setDrawerOpen(true)}>
          New user
        </Button>
      </div>

      {isLoading ? (
        <PageSpinner />
      ) : !data?.users.length ? (
        <Card>
          <EmptyState icon={UsersIcon} title="No users yet" />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/40 text-gray-500 dark:text-gray-400 uppercase text-[11px]">
              <tr>
                <th className="text-left px-6 py-3 font-semibold">Name</th>
                <th className="text-left px-6 py-3 font-semibold hidden sm:table-cell">Email</th>
                <th className="text-left px-6 py-3 font-semibold">Role</th>
                <th className="text-left px-6 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                  <td className="px-6 py-4 font-medium text-gray-900 dark:text-white">{u.name}</td>
                  <td className="px-6 py-4 text-gray-500 dark:text-gray-400 hidden sm:table-cell">{u.email}</td>
                  <td className="px-6 py-4">
                    <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                      {ROLE_LABEL[u.role]}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${u.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-200 text-gray-600'}`}>
                      {u.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="New user" icon={<UsersIcon className="w-5 h-5 text-white" />}>
        <div className="space-y-4">
          {error && <FieldError>{error}</FieldError>}
          <div>
            <Label required>Full name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label required>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label required>Temporary password</Label>
            <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 10 characters" />
          </div>
          <div>
            <Label required>Role</Label>
            <Select value={role} onChange={(v) => setRole(v as Role)} options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
          </div>
          {role === 'MARKETING_HEAD' && (
            <div>
              <Label>Site access</Label>
              <div className="space-y-1.5 border border-gray-200 dark:border-gray-700 rounded-lg p-2 max-h-40 overflow-y-auto custom-scrollbar">
                {sitesData?.sites.map((s) => {
                  const checked = siteIds.includes(s.id)
                  return (
                    <button
                      type="button"
                      key={s.id}
                      onClick={() => setSiteIds((prev) => (checked ? prev.filter((id) => id !== s.id) : [...prev, s.id]))}
                      className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-sm"
                    >
                      <span>{s.name}</span>
                      {checked && <Check className="w-4 h-4 theme-text" />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
        <div className="pt-2 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDrawerOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={createUser.isPending} onClick={() => createUser.mutate()} disabled={!name || !email || !password}>
            Create user
          </Button>
        </div>
      </Drawer>
    </div>
  )
}

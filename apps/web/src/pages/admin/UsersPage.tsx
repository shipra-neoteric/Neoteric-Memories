import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Users as UsersIcon, Plus, Check, Pencil } from 'lucide-react'
import { ROLES, type Permission, type Role } from '@neoteric-memories/shared'
import { apiFetch, ApiError } from '../../lib/api'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Drawer } from '../../components/ui/Drawer'
import { Input, Label, FieldError } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { EmptyState, PageSpinner } from '../../components/ui/EmptyState'
import { PermissionMatrix, Toggle } from '../../components/PermissionMatrix'
import { toastSuccess } from '../../lib/toast'

interface AdminUser {
  id: string
  name: string
  email: string
  role: Role
  permissions: Permission[]
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

interface FormState {
  name: string
  email: string
  password: string
  role: Role
  siteIds: string[]
  permissions: Permission[]
  isActive: boolean
}

const EMPTY_FORM: FormState = { name: '', email: '', password: '', role: 'EVENT_MANAGER', siteIds: [], permissions: [], isActive: true }

export function UsersPage() {
  const queryClient = useQueryClient()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['users'], queryFn: () => apiFetch<{ users: AdminUser[] }>('/api/admin/users') })
  const { data: sitesData } = useQuery({ queryKey: ['sites'], queryFn: () => apiFetch<{ sites: Site[] }>('/api/admin/sites') })

  function openCreate() {
    setEditingUser(null)
    setForm(EMPTY_FORM)
    setError(null)
    setDrawerOpen(true)
  }

  function openEdit(user: AdminUser) {
    setEditingUser(user)
    setForm({ name: user.name, email: user.email, password: '', role: user.role, siteIds: [], permissions: [...user.permissions], isActive: user.isActive })
    setError(null)
    setDrawerOpen(true)
  }

  const saveUser = useMutation({
    mutationFn: () => {
      const { name, email, password, role, siteIds, permissions, isActive } = form
      if (editingUser) {
        const body: Record<string, unknown> = { name, email, role, siteIds, permissions, isActive }
        if (password) body.password = password
        return apiFetch(`/api/admin/users/${editingUser.id}`, { method: 'PATCH', body })
      }
      return apiFetch('/api/admin/users', { method: 'POST', body: { name, email, password, role, siteIds, permissions, isActive } })
    },
    onSuccess: () => {
      toastSuccess(editingUser ? 'User updated' : 'User created')
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setDrawerOpen(false)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to save user'),
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Users</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Team members, their roles, and their individual permissions.</p>
        </div>
        <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={openCreate}>
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
                <th className="text-left px-6 py-3 font-semibold hidden sm:table-cell">Permissions</th>
                <th className="text-left px-6 py-3 font-semibold">Status</th>
                <th className="text-right px-6 py-3 font-semibold">Actions</th>
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
                  <td className="px-6 py-4 text-gray-500 dark:text-gray-400 hidden sm:table-cell">
                    {u.role === 'MASTER_ADMIN' ? 'All (Master Admin)' : `${u.permissions.length} granted`}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${u.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-200 text-gray-600'}`}>
                      {u.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => openEdit(u)}
                      className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                      aria-label={`Edit ${u.name}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editingUser ? 'Edit user' : 'New user'}
        icon={<UsersIcon className="w-5 h-5 text-white" />}
        width="lg"
      >
        <div className="space-y-4">
          {error && <FieldError>{error}</FieldError>}
          <div>
            <Label required>Full name</Label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <Label required>Email</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <Label required={!editingUser}>{editingUser ? 'New password (leave blank to keep current)' : 'Temporary password'}</Label>
            <Input type="text" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
          </div>
          <div>
            <Label required>Role</Label>
            <Select value={form.role} onChange={(v) => setForm((f) => ({ ...f, role: v as Role }))} options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
          </div>
          {form.role === 'MARKETING_HEAD' && (
            <div>
              <Label>Site access</Label>
              <div className="space-y-1.5 border border-gray-200 dark:border-gray-700 rounded-lg p-2 max-h-40 overflow-y-auto custom-scrollbar">
                {sitesData?.sites.map((s) => {
                  const checked = form.siteIds.includes(s.id)
                  return (
                    <button
                      type="button"
                      key={s.id}
                      onClick={() =>
                        setForm((f) => ({ ...f, siteIds: checked ? f.siteIds.filter((id) => id !== s.id) : [...f.siteIds, s.id] }))
                      }
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
          <div className="flex items-center justify-between">
            <Label>Account status</Label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-gray-400">{form.isActive ? 'Active' : 'Inactive'}</span>
              <Toggle checked={form.isActive} onChange={(v) => setForm((f) => ({ ...f, isActive: v }))} />
            </div>
          </div>

          <PermissionMatrix
            value={form.permissions}
            onChange={(permissions) => setForm((f) => ({ ...f, permissions }))}
            roleForDefaults={form.role}
          />
        </div>
        <div className="pt-2 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDrawerOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={saveUser.isPending}
            onClick={() => saveUser.mutate()}
            disabled={!form.name || !form.email || (!editingUser && !form.password)}
          >
            {editingUser ? 'Save changes' : 'Create user'}
          </Button>
        </div>
      </Drawer>
    </div>
  )
}

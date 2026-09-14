import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { PERMISSIONS, ROLE_PERMISSIONS, type Permission, type Role } from '@neoteric-memories/shared'
import { Button } from './ui/Button'
import { useTheme } from '../context/ThemeContext'

interface PermissionMeta {
  label: string
  caption: string
}

interface ModuleDef {
  key: string
  label: string
  permissions: Permission[]
}

const PERMISSION_META: Record<Permission, PermissionMeta> = {
  'site:view': { label: 'View', caption: 'See the project/site list' },
  'site:manage': { label: 'Manage', caption: 'Create, edit, and archive sites' },
  'user:manage': { label: 'Manage', caption: 'Create/edit users and their permissions' },
  'event:view': { label: 'View', caption: 'See event details' },
  'event:create': { label: 'Create', caption: 'Create new events' },
  'event:edit': { label: 'Edit', caption: 'Edit event details' },
  'event:close': { label: 'Close', caption: 'Close or pause an event' },
  'event:delete': { label: 'Delete', caption: 'Permanently delete an event' },
  'event:manage_qr': { label: 'Manage QR', caption: 'Generate or revoke the guest QR/link' },
  'event:manage_assignments': { label: 'Manage Assignments', caption: 'Assign managers/photographers to events' },
  'event:manage_threshold': { label: 'Manage Threshold', caption: 'Change the face-match confidence threshold' },
  'event:manage_integrations': { label: 'Manage Integrations', caption: 'Connect/manage Google Drive sync' },
  'photo:upload': { label: 'Upload', caption: 'Upload event photographs' },
  'photo:view': { label: 'View', caption: 'Browse the photo library' },
  'photo:delete': { label: 'Delete', caption: 'Delete photographs' },
  'consent:manage': { label: 'Manage', caption: 'Edit guest consent text versions' },
  'retention:manage': { label: 'Manage', caption: 'Edit data retention policies' },
  'audit:view': { label: 'View', caption: 'View the audit & security log' },
  'settings:manage': { label: 'Manage', caption: 'Change system-wide settings' },
  'report:view': { label: 'View', caption: 'View wrong-match reports' },
  'report:resolve': { label: 'Resolve', caption: 'Mark wrong-match reports reviewed/dismissed' },
  'analytics:view': { label: 'View', caption: 'View dashboard analytics' },
}

const MODULES: ModuleDef[] = [
  { key: 'site', label: 'Sites', permissions: PERMISSIONS.filter((p) => p.startsWith('site:')) },
  { key: 'user', label: 'Users', permissions: PERMISSIONS.filter((p) => p.startsWith('user:')) },
  { key: 'event', label: 'Events', permissions: PERMISSIONS.filter((p) => p.startsWith('event:')) },
  { key: 'photo', label: 'Photos', permissions: PERMISSIONS.filter((p) => p.startsWith('photo:')) },
  { key: 'consent', label: 'Consent Versions', permissions: PERMISSIONS.filter((p) => p.startsWith('consent:')) },
  { key: 'retention', label: 'Retention Policies', permissions: PERMISSIONS.filter((p) => p.startsWith('retention:')) },
  { key: 'audit', label: 'Audit & Security', permissions: PERMISSIONS.filter((p) => p.startsWith('audit:')) },
  { key: 'settings', label: 'Settings', permissions: PERMISSIONS.filter((p) => p.startsWith('settings:')) },
  { key: 'report', label: 'Wrong-Match Reports', permissions: PERMISSIONS.filter((p) => p.startsWith('report:')) },
  { key: 'analytics', label: 'Analytics', permissions: PERMISSIONS.filter((p) => p.startsWith('analytics:')) },
]

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  const { getThemeColor } = useTheme()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors"
      style={{ backgroundColor: checked ? getThemeColor() : undefined }}
    >
      <span className={`absolute inset-0 rounded-full ${checked ? '' : 'bg-gray-300 dark:bg-gray-600'}`} />
      <span
        className={`relative inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

interface PermissionMatrixProps {
  value: Permission[]
  onChange: (next: Permission[]) => void
  roleForDefaults?: Role
}

/**
 * Per-user permission toggle matrix — grouped by module, with a per-module
 * "select unit" bulk toggle and an optional "Load role defaults" convenience button.
 * Loading defaults is always an explicit action, never automatic: a freshly created
 * user starts at zero authorizations regardless of the selected role, matching how
 * the reference system (Nexora ERP) behaves.
 */
export function PermissionMatrix({ value, onChange, roleForDefaults }: PermissionMatrixProps) {
  const [search, setSearch] = useState('')

  const filteredModules = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return MODULES
    return MODULES.map((mod) => ({
      ...mod,
      permissions: mod.permissions.filter(
        (p) => mod.label.toLowerCase().includes(q) || p.toLowerCase().includes(q) || PERMISSION_META[p].label.toLowerCase().includes(q)
      ),
    })).filter((mod) => mod.permissions.length > 0 || mod.label.toLowerCase().includes(q))
  }, [search])

  function toggleOne(permission: Permission, checked: boolean) {
    onChange(checked ? [...value, permission] : value.filter((p) => p !== permission))
  }

  function toggleModule(mod: ModuleDef, checked: boolean) {
    const rest = value.filter((p) => !mod.permissions.includes(p))
    onChange(checked ? [...rest, ...mod.permissions] : rest)
  }

  function loadRoleDefaults() {
    if (!roleForDefaults) return
    onChange([...ROLE_PERMISSIONS[roleForDefaults]])
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Role Permission Matrix</h3>
          <p className="text-xs text-gray-400">Assigned authorizations: {value.length}</p>
        </div>
        <div className="flex items-center gap-2">
          {roleForDefaults && (
            <Button type="button" variant="ghost" className="text-xs px-2 py-1" onClick={loadRoleDefaults}>
              Load role defaults
            </Button>
          )}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search matrix..."
              className="pl-8 pr-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white w-40 sm:w-52"
            />
          </div>
        </div>
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar border border-gray-200 dark:border-gray-700 rounded-lg p-2">
        {filteredModules.map((mod) => {
          if (mod.permissions.length === 0) return null
          const allSelected = mod.permissions.every((p) => value.includes(p))
          return (
            <div key={mod.key} className="rounded-lg overflow-hidden border border-gray-100 dark:border-gray-700">
              <div className="flex items-center justify-between px-3 py-2 bg-orange-50 dark:bg-gray-700/40">
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{mod.label}</p>
                  <p className="text-[11px] text-gray-400">
                    {mod.permissions.length} node{mod.permissions.length === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-400">Select unit</span>
                  <Toggle checked={allSelected} onChange={(checked) => toggleModule(mod, checked)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-gray-100 dark:bg-gray-700">
                {mod.permissions.map((p) => (
                  <div key={p} className="flex items-center justify-between px-3 py-2 bg-white dark:bg-gray-800">
                    <div>
                      <p className="text-sm text-gray-900 dark:text-white">{PERMISSION_META[p].label}</p>
                      <p className="text-[11px] text-gray-400">{PERMISSION_META[p].caption}</p>
                    </div>
                    <Toggle checked={value.includes(p)} onChange={(checked) => toggleOne(p, checked)} />
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

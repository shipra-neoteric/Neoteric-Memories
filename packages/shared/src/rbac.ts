import type { Role } from './constants.js'

export const PERMISSIONS = [
  'site:manage',
  'site:view',
  'user:manage',
  'event:create',
  'event:edit',
  'event:view',
  'event:close',
  'event:delete',
  'event:manage_qr',
  'event:manage_assignments',
  'event:manage_threshold',
  'event:manage_integrations',
  'photo:upload',
  'photo:view',
  'photo:delete',
  'consent:manage',
  'retention:manage',
  'audit:view',
  'settings:manage',
  'report:view',
  'report:resolve',
  'analytics:view',
] as const
export type Permission = (typeof PERMISSIONS)[number]

/**
 * Role -> permission matrix. This is the *ceiling* of what a role can ever do.
 * Site-level and event-level scoping (UserSiteAccess, EventAssignment) is enforced
 * separately on the backend and further narrows what a given user may act on within
 * these permissions — see docs/RBAC.md for the full matrix including scoping rules.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  MASTER_ADMIN: [...PERMISSIONS],
  MARKETING_HEAD: [
    'site:view',
    'event:create',
    'event:edit',
    'event:view',
    'event:close',
    'event:manage_qr',
    'event:manage_assignments',
    'event:manage_integrations',
    'photo:view',
    'analytics:view',
    'report:view',
  ],
  EVENT_MANAGER: [
    'event:view',
    'event:edit',
    'event:close',
    'event:manage_qr',
    'event:manage_integrations',
    'photo:upload',
    'photo:view',
    'photo:delete',
    'analytics:view',
    'report:view',
    'report:resolve',
  ],
  PHOTOGRAPHER: ['event:view', 'photo:upload', 'photo:view'],
  SUPPORT_EXECUTIVE: ['report:view', 'report:resolve', 'event:view'],
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}

export function hasAnyPermission(role: Role, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(role, p))
}

/** Roles that are inherently site/event-scoped (their access is further narrowed by assignment records, never global by default). */
export const SCOPED_ROLES: Role[] = ['MARKETING_HEAD', 'EVENT_MANAGER', 'PHOTOGRAPHER']

/** Roles allowed to see guest selfie images / raw biometric artifacts at all (support/debugging of wrong-match reports uses cropped face thumbnails only, never raw selfies — see docs/PRIVACY.md). */
export const NEVER_VIEWS_GUEST_SELFIES: Role[] = ['PHOTOGRAPHER', 'SUPPORT_EXECUTIVE', 'MARKETING_HEAD']

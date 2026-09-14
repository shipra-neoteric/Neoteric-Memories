import { describe, expect, it } from 'vitest'
import { hasPermission, hasUserPermission, ROLE_PERMISSIONS, ROLES } from '@neoteric-memories/shared'

describe('RBAC permission matrix', () => {
  it('gives MASTER_ADMIN every permission', () => {
    expect(hasPermission('MASTER_ADMIN', 'event:delete')).toBe(true)
    expect(hasPermission('MASTER_ADMIN', 'user:manage')).toBe(true)
    expect(hasPermission('MASTER_ADMIN', 'retention:manage')).toBe(true)
  })

  it('never gives PHOTOGRAPHER permission to delete events, manage users, or view audit logs', () => {
    expect(hasPermission('PHOTOGRAPHER', 'event:delete')).toBe(false)
    expect(hasPermission('PHOTOGRAPHER', 'user:manage')).toBe(false)
    expect(hasPermission('PHOTOGRAPHER', 'audit:view')).toBe(false)
    expect(hasPermission('PHOTOGRAPHER', 'photo:upload')).toBe(true)
  })

  it('never gives SUPPORT_EXECUTIVE permission to change match thresholds or browse photo uploads', () => {
    expect(hasPermission('SUPPORT_EXECUTIVE', 'event:manage_threshold')).toBe(false)
    expect(hasPermission('SUPPORT_EXECUTIVE', 'photo:upload')).toBe(false)
    expect(hasPermission('SUPPORT_EXECUTIVE', 'photo:view')).toBe(false)
    expect(hasPermission('SUPPORT_EXECUTIVE', 'report:view')).toBe(true)
  })

  it('every role is defined in the matrix with no accidental gaps', () => {
    for (const role of ROLES) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined()
      expect(Array.isArray(ROLE_PERMISSIONS[role])).toBe(true)
    }
  })
})

describe('hasUserPermission (the live, per-user enforcement check)', () => {
  it('MASTER_ADMIN bypasses regardless of what is actually stored on the user', () => {
    expect(hasUserPermission({ role: 'MASTER_ADMIN', permissions: [] }, 'user:manage')).toBe(true)
    expect(hasUserPermission({ role: 'MASTER_ADMIN', permissions: [] }, 'retention:manage')).toBe(true)
  })

  it('a non-MASTER_ADMIN role has no permissions at all unless explicitly granted, even ones their role normally allows', () => {
    expect(hasUserPermission({ role: 'PHOTOGRAPHER', permissions: [] }, 'photo:upload')).toBe(false)
  })

  it('a role can be explicitly granted a permission outside its normal role-default ceiling', () => {
    expect(hasUserPermission({ role: 'SUPPORT_EXECUTIVE', permissions: ['photo:view'] }, 'photo:view')).toBe(true)
  })

  it('a role can be explicitly denied a permission that its role-default set would normally include', () => {
    const withoutUpload = ROLE_PERMISSIONS.PHOTOGRAPHER.filter((p) => p !== 'photo:upload')
    expect(hasUserPermission({ role: 'PHOTOGRAPHER', permissions: [...withoutUpload] }, 'photo:upload')).toBe(false)
    expect(hasUserPermission({ role: 'PHOTOGRAPHER', permissions: [...withoutUpload] }, 'photo:view')).toBe(true)
  })
})

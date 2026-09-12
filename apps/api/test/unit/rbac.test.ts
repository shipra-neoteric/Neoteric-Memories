import { describe, expect, it } from 'vitest'
import { hasPermission, ROLE_PERMISSIONS, ROLES } from '@neoteric-memories/shared'

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

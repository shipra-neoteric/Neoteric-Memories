import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Role } from '@neoteric-memories/shared'
import { apiFetch, ApiError } from '../lib/api'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: Role
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    try {
      const res = await apiFetch<{ user: AuthUser }>('/api/admin/auth/me')
      setUser(res.user)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setUser(null)
      else throw err
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // The guest journey (/e/:token/*) never needs an admin session — skip the
    // (always-401-for-a-guest) whoami call there rather than firing it on every
    // guest page load.
    if (!window.location.pathname.startsWith('/admin')) {
      setLoading(false)
      return
    }
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const login = async (email: string, password: string) => {
    const res = await apiFetch<{ user: AuthUser }>('/api/admin/auth/login', { method: 'POST', body: { email, password } })
    setUser(res.user)
  }

  const logout = async () => {
    await apiFetch('/api/admin/auth/logout', { method: 'POST' })
    setUser(null)
  }

  return <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}

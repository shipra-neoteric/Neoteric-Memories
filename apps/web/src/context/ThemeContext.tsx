import { createContext, useContext, useRef, useState, type ReactNode } from 'react'

type Theme = 'light' | 'dark'

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
  getThemeColor: () => string
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('theme')
  if (stored === 'dark' || stored === 'light') return stored
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const applied = useRef(false)
  if (!applied.current) {
    // Applied synchronously on first render (not in a useEffect) to avoid a flash of the wrong theme.
    const initial = getInitialTheme()
    document.documentElement.classList.toggle('dark', initial === 'dark')
    applied.current = true
  }

  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      document.documentElement.classList.toggle('dark', next === 'dark')
      localStorage.setItem('theme', next)
      return next
    })
  }

  // Single-tenant orange brand for L1 (no per-company theme record yet) — kept
  // behind this hook so a future per-site/company color can be wired in without
  // touching call sites, matching the Nexora `getThemeColor()` convention.
  const getThemeColor = () => '#f97316'

  return <ThemeContext.Provider value={{ theme, toggleTheme, getThemeColor }}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}

import { useState } from 'react'
import { Moon, Sun, LogOut, User, KeyRound } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import { ChangePasswordDrawer } from '../components/ChangePasswordDrawer'

export function Header() {
  const { theme, toggleTheme } = useTheme()
  const { user, logout } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const navigate = useNavigate()

  return (
    <header className="h-16 flex items-center justify-between px-4 sm:px-6 bg-white/90 dark:bg-gray-800/95 backdrop-blur-xl border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
      <div className="lg:hidden font-bold text-gray-900 dark:text-white">Neoteric Memories</div>
      <div className="hidden lg:block" />
      <div className="flex items-center gap-2">
        <button
          onClick={toggleTheme}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all active:scale-95"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <div className="w-8 h-8 rounded-full theme-bg flex items-center justify-center text-white text-xs font-bold">
              {user?.name?.slice(0, 1).toUpperCase() ?? <User className="w-4 h-4" />}
            </div>
            <span className="hidden sm:block text-sm font-medium text-gray-700 dark:text-gray-200">{user?.name}</span>
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 py-1">
              <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
                <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{user?.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{user?.email}</p>
                <p className="text-[10px] font-bold uppercase tracking-wide theme-text mt-1">{user?.role.replace('_', ' ')}</p>
              </div>
              <button
                onClick={() => {
                  setMenuOpen(false)
                  setChangePasswordOpen(true)
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <KeyRound className="w-4 h-4" /> Change password
              </button>
              <button
                onClick={async () => {
                  await logout()
                  navigate('/login')
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                <LogOut className="w-4 h-4" /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>

      <ChangePasswordDrawer
        open={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
        onChanged={async () => {
          setChangePasswordOpen(false)
          await logout()
          navigate('/login')
        }}
      />
    </header>
  )
}

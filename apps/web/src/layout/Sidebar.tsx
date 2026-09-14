import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Building2,
  Users,
  CalendarDays,
  ShieldCheck,
  Clock,
  ScrollText,
  Flag,
  Camera,
} from 'lucide-react'
import { hasUserPermission, type Permission } from '@neoteric-memories/shared'
import { useAuth } from '../context/AuthContext'

interface NavItem {
  to: string
  label: string
  icon: typeof LayoutDashboard
  permission: Permission
}

const NAV_ITEMS: NavItem[] = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'analytics:view' },
  { to: '/admin/events', label: 'Events', icon: CalendarDays, permission: 'event:view' },
  { to: '/admin/sites', label: 'Projects / Sites', icon: Building2, permission: 'site:view' },
  { to: '/admin/users', label: 'Users', icon: Users, permission: 'user:manage' },
  { to: '/admin/consent-versions', label: 'Consent Versions', icon: ShieldCheck, permission: 'consent:manage' },
  { to: '/admin/retention-policies', label: 'Retention Policies', icon: Clock, permission: 'retention:manage' },
  { to: '/admin/reports', label: 'Wrong-Match Reports', icon: Flag, permission: 'report:view' },
  { to: '/admin/audit', label: 'Audit & Security', icon: ScrollText, permission: 'audit:view' },
]

export function Sidebar() {
  const { user } = useAuth()
  if (!user) return null
  const items = NAV_ITEMS.filter((item) => hasUserPermission(user, item.permission))

  return (
    <aside className="hidden lg:flex lg:my-1 lg:ml-1 lg:rounded-xl lg:w-64 flex-col bg-white/90 dark:bg-gray-800/95 backdrop-blur-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 dark:border-gray-700">
      <div className="h-16 flex items-center gap-2.5 px-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
        <div className="w-9 h-9 rounded-lg theme-bg flex items-center justify-center flex-shrink-0">
          <Camera className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900 dark:text-white leading-tight truncate">Neoteric Memories</p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">Find Your Event Photos</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto custom-scrollbar p-2.5 space-y-0.5">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-2.5 pt-2 pb-1 pointer-events-none">Manage</p>
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-2.5 text-[15px] py-2 px-2.5 rounded-lg transition-colors ${
                isActive ? 'theme-bg/10 theme-text font-semibold bg-primary-50 dark:bg-primary-900/20' : 'text-gray-600 dark:text-gray-300 theme-nav-hover'
              }`
            }
          >
            <item.icon className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}

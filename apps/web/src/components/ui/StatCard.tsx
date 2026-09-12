import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function StatCard({ label, value, icon: Icon }: { label: string; value: string | number; icon: LucideIcon }) {
  return (
    <div className="h-full bg-white dark:bg-gray-800 rounded-lg p-3 sm:p-4 shadow hover:shadow-lg transition-all duration-200 text-left relative overflow-hidden">
      <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">{label}</p>
      <p className="text-2xl sm:text-3xl font-medium text-gray-900 dark:text-white mt-2">{value}</p>
      <Icon className="absolute bottom-2 right-2 w-6 h-6 text-gray-400" strokeWidth={2.5} />
    </div>
  )
}

export function StatCardGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">{children}</div>
}

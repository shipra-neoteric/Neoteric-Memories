import type { ReactNode } from 'react'

export function Badge({ className = '', children }: { className?: string; children: ReactNode }) {
  return <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${className}`}>{children}</span>
}

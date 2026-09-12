import type { ReactNode } from 'react'
import { Camera } from 'lucide-react'

export function GuestShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <header className="h-14 flex items-center justify-center gap-2 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
        <div className="w-7 h-7 rounded-md theme-bg flex items-center justify-center">
          <Camera className="w-4 h-4 text-white" />
        </div>
        <span className="text-sm font-bold text-gray-800 dark:text-gray-100">Neoteric Memories</span>
      </header>
      <main className="flex-1 flex flex-col max-w-md w-full mx-auto px-4 py-6">{children}</main>
      <footer className="text-center py-4 text-[11px] text-gray-400">
        Face matching is probabilistic, not identity verification.{' '}
        <a href="#privacy" className="underline">
          Privacy notice
        </a>
      </footer>
    </div>
  )
}

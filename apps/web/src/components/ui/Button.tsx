import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useTheme } from '../../context/ThemeContext'

type Variant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  icon?: ReactNode
  loading?: boolean
}

const BASE = 'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100'

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'text-white hover:opacity-90',
  secondary: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600',
  danger: 'bg-red-600 hover:bg-red-700 text-white',
  success: 'bg-green-600 hover:bg-green-700 text-white',
  ghost: 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700',
}

export function Button({ variant = 'secondary', icon, loading, className = '', children, style, disabled, ...rest }: ButtonProps) {
  const { getThemeColor } = useTheme()
  const themedStyle = variant === 'primary' ? { backgroundColor: getThemeColor(), ...style } : style
  return (
    <button
      className={`${BASE} ${VARIANT_CLASSES[variant]} ${className}`}
      style={themedStyle}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  )
}

export function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}

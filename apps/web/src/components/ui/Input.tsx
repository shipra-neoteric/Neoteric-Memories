import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'

const inputBase =
  'w-full px-3 py-2.5 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 border-gray-300 dark:border-gray-600 disabled:opacity-60 disabled:cursor-not-allowed'

export function Input(props: InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) {
  const { error, className = '', ...rest } = props
  return <input className={`${inputBase} ${error ? 'border-red-400' : ''} ${className}`} {...rest} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: boolean }) {
  const { error, className = '', ...rest } = props
  return <textarea className={`${inputBase} ${error ? 'border-red-400' : ''} ${className}`} {...rest} />
}

export function Label({ children, required, ...rest }: LabelHTMLAttributes<HTMLLabelElement> & { children: ReactNode; required?: boolean }) {
  return (
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5" {...rest}>
      {children}
      {required && <span className="text-red-500"> *</span>}
    </label>
  )
}

export function FieldError({ children }: { children?: string }) {
  if (!children) return null
  return <p className="text-xs text-red-500 mt-1">{children}</p>
}

export function MicroLabel({ children }: { children: ReactNode }) {
  return <p className="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1">{children}</p>
}

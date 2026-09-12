import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value: string | undefined
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
}

/** Custom dropdown (never a native <select>) per the Nexora design system convention. */
export function Select({ value, onChange, options, placeholder = 'Select...', disabled }: SelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { getThemeColor } = useTheme()

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const selected = options.find((o) => o.value === value)

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="w-full h-10 px-3 py-2 border rounded-md shadow-sm bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-sm text-left flex items-center justify-between disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <span className={selected ? 'text-gray-900 dark:text-white' : 'text-gray-400'}>{selected?.label ?? placeholder}</span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto custom-scrollbar bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          {options.length === 0 && <div className="px-3 py-2 text-sm text-gray-400">No options</div>}
          {options.map((opt) => (
            <button
              type="button"
              key={opt.value}
              onClick={() => {
                onChange(opt.value)
                setOpen(false)
              }}
              className="w-full px-3 py-2 text-sm text-left flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <span>{opt.label}</span>
              {opt.value === value && <Check className="w-4 h-4" style={{ color: getThemeColor() }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

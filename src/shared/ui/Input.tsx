import type { InputHTMLAttributes, ReactNode } from 'react'

import { cn } from '@/shared/lib/cn'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leading?: ReactNode
  trailing?: ReactNode
}

export function Input({ className, leading, trailing, ...props }: InputProps) {
  if (leading || trailing) {
    return (
      <div
        className={cn(
          'border-border bg-surface flex h-9 items-center gap-2 rounded-lg border px-2.5 text-sm',
          'focus-within:outline-ring focus-within:outline-2 focus-within:outline-offset-2',
          className,
        )}
      >
        {leading ? <span className="text-faint">{leading}</span> : null}
        <input
          className="text-foreground placeholder:text-faint min-w-0 flex-1 bg-transparent outline-none disabled:opacity-50"
          {...props}
        />
        {trailing}
      </div>
    )
  }

  return (
    <input
      className={cn(
        'border-border bg-surface text-foreground h-9 w-full rounded-lg border px-2.5 text-sm',
        'placeholder:text-faint focus:outline-ring outline-none focus:outline-2 focus:outline-offset-2 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

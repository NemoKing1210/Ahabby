import type { ReactNode } from 'react'

import { cn } from '@/shared/lib/cn'

/**
 * One labelled control of a form: the label, the control, then an optional hint or error.
 *
 * A `div` plus a real `label[for]`, not a wrapping `<label>`: the owner select is a Radix
 * button, and a label element around it would steal its activation.
 */
export function FormField({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string
  htmlFor?: string
  hint?: string
  error?: string | null
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-foreground text-[0.8125rem] font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-danger-fg text-[0.75rem]" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-faint text-[0.75rem] leading-relaxed">{hint}</p>
      ) : null}
    </div>
  )
}

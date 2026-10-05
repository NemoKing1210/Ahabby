import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'

import { cn } from '@/shared/lib/cn'

const chipStyles = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.75rem] font-medium whitespace-nowrap transition-colors duration-150 ease-warm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      active: {
        true: 'border-accent/40 bg-accent-soft text-accent-strong',
        false:
          'border-border bg-surface text-muted hover:border-border-strong hover:text-foreground',
      },
    },
    defaultVariants: { active: false },
  },
)

export interface ChipProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof chipStyles> {
  label: string
  /** Rendered after the label — how many items the toggle matches. */
  count?: number
}

/**
 * Toggleable pill for the compact filter rows above a list, so it is a `<button>` with
 * `aria-pressed` rather than a checkbox: the control reads as a filter, not a form field.
 *
 * The label is a `string` (not `children`) because the count is folded into an explicit
 * `aria-label`: a text node and a badge inside the same button otherwise collapse into one
 * word for assistive tech ("Available2").
 */
export function Chip({ label, count, className, active, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active ?? false}
      aria-label={count === undefined ? label : `${label} ${count}`}
      className={cn(chipStyles({ active }), className)}
      {...props}
    >
      {label}
      {count === undefined ? null : (
        <span
          aria-hidden
          className={cn('text-[0.6875rem] tabular-nums', active ? 'opacity-80' : 'text-faint')}
        >
          {count}
        </span>
      )}
    </button>
  )
}

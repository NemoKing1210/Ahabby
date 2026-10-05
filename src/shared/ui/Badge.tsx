import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'

import { cn } from '@/shared/lib/cn'

const badgeStyles = cva(
  'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[0.6875rem] font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-surface-2 text-muted',
        accent:
          'border-transparent bg-[color-mix(in_oklab,var(--color-accent)_16%,var(--color-surface))] text-accent-strong',
        success:
          'border-transparent bg-[color-mix(in_oklab,var(--color-success)_18%,var(--color-surface))] text-success-fg',
        info: 'border-transparent bg-[color-mix(in_oklab,var(--color-info)_18%,var(--color-surface))] text-info-fg',
        warning:
          'border-transparent bg-[color-mix(in_oklab,var(--color-warning)_20%,var(--color-surface))] text-warning-fg',
        danger:
          'border-transparent bg-[color-mix(in_oklab,var(--color-danger)_18%,var(--color-surface))] text-danger-fg',
        outline: 'border-border bg-transparent text-muted',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeStyles> {
  /** Small leading dot, used for status badges. */
  dot?: 'success' | 'neutral' | 'danger' | 'warning'
}

const DOT_COLOR: Record<NonNullable<BadgeProps['dot']>, string> = {
  success: 'bg-success',
  neutral: 'bg-faint',
  danger: 'bg-danger',
  warning: 'bg-warning',
}

export function Badge({ className, tone, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeStyles({ tone }), className)} {...props}>
      {dot ? <span aria-hidden className={cn('size-1.5 rounded-full', DOT_COLOR[dot])} /> : null}
      {children}
    </span>
  )
}

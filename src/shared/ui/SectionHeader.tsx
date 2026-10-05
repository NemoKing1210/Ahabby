import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/shared/lib/cn'

import { Badge } from './Badge'

/**
 * Heading above a group inside a list — a library name group, an agent group, a kind of
 * resource. The icon tile and the count badge keep the eye moving down a long page; `children`
 * is where a group puts its own context (the agents that share the group, for instance).
 */
export function SectionHeader({
  icon: Icon,
  leading,
  title,
  count,
  children,
  className,
}: {
  icon?: LucideIcon
  /** Rendered instead of the icon tile — e.g. an agent's brand avatar for an owner group. */
  leading?: ReactNode
  title: string
  /** Rendered as a count badge; omit it when the number is meaningless for this group. */
  count?: number
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {leading ??
        (Icon ? (
          <span
            aria-hidden
            className="bg-surface-2 text-muted inline-flex size-6 shrink-0 items-center justify-center rounded-md"
          >
            <Icon className="size-3.5" />
          </span>
        ) : null)}
      <h3 className="text-[0.9375rem]">{title}</h3>
      {count === undefined ? null : <Badge tone="neutral">{count}</Badge>}
      {children}
    </div>
  )
}

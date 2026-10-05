import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/shared/lib/cn'
import { Card } from '@/shared/ui/Card'

/**
 * Heading of one settings subpage: the icon tile and the description are what tell a section
 * apart from its neighbours at a glance, now that each section lives on its own page.
 */
export function SettingsPageHeading({
  icon: Icon,
  title,
  hint,
}: {
  icon: LucideIcon
  title: string
  hint?: string
}) {
  return (
    <header className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="bg-accent-soft text-accent-strong inline-flex size-8 shrink-0 items-center justify-center rounded-lg"
        >
          <Icon className="size-4" />
        </span>
        <h2 className="text-xl">{title}</h2>
      </div>
      {hint ? <p className="text-muted max-w-prose text-[0.8125rem]">{hint}</p> : null}
    </header>
  )
}

/**
 * The cards of one settings subpage, laid out as a single concentric run — the same treatment
 * the agent list and the agent overview use (`.ah-card-stack`: a tight gap, and only the corners
 * at the exposed ends keep the full radius). The page heading stays outside the stack.
 */
export function SettingsSections({ children }: { children: ReactNode }) {
  return <div className="ah-card-stack">{children}</div>
}

/** A card of related settings; a page with one group of fields uses no title at all. */
export function SettingsSection({
  title,
  hint,
  children,
  className,
}: {
  title?: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  const headed = Boolean(title ?? hint)

  return (
    <Card className={cn('flex flex-col gap-1 p-5', className)}>
      {title ? <h3 className="text-base font-medium">{title}</h3> : null}
      {hint ? <p className="text-muted max-w-prose text-[0.8125rem]">{hint}</p> : null}
      <div className={cn('flex flex-col', headed && 'mt-2')}>{children}</div>
    </Card>
  )
}

/** A labelled setting with its control on the right; the control keeps its width on wrap. */
export function SettingRow({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-4 py-3', className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm">{label}</span>
        {hint ? <p className="text-muted max-w-prose text-[0.8125rem]">{hint}</p> : null}
      </div>
      {children}
    </div>
  )
}

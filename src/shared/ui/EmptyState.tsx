import { AlertTriangle, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { toAppError } from '@/shared/api/errors'
import i18n from '@/shared/i18n'
import { cn } from '@/shared/lib/cn'

import { Button } from './Button'

/** Empty state with an actionable hint — never a bare "no data". */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: LucideIcon
  title: string
  hint?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'border-border bg-surface/60 flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center',
        className,
      )}
    >
      {Icon ? <Icon className="text-faint size-6" aria-hidden /> : null}
      <div className="flex flex-col gap-1">
        <p className="text-foreground font-serif text-base">{title}</p>
        {hint ? <p className="text-muted max-w-md text-[0.8125rem]">{hint}</p> : null}
      </div>
      {action}
    </div>
  )
}

/** Error state that always names the error class and offers a retry. */
export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown
  onRetry?: () => void
  className?: string
}) {
  const appError = toAppError(error)
  return (
    <div
      role="alert"
      className={cn(
        'border-border bg-surface flex flex-col gap-2 rounded-xl border p-5',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="text-danger-fg size-4" aria-hidden />
        <p className="text-foreground text-sm">{i18n.t(`errors.${appError.code}`)}</p>
      </div>
      <p className="text-muted font-mono text-[0.75rem] break-words">{appError.message}</p>
      {onRetry ? (
        <div>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {i18n.t('common.retry')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

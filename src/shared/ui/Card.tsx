import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/shared/lib/cn'

/** Thin bordered surface — the workhorse container of the whole UI. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'border-border bg-surface text-foreground rounded-xl border shadow-none',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 px-5 pt-5 pb-3', className)} {...props} />
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-medium', className)} {...props} />
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-muted text-[13px]', className)} {...props} />
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5', className)} {...props} />
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('border-border flex items-center gap-2 border-t px-5 py-3', className)}
      {...props}
    />
  )
}

/** A label/value row used across the overview tabs. */
export function KeyValue({
  label,
  children,
  className,
  mono = false,
}: {
  label: ReactNode
  children: ReactNode
  className?: string
  mono?: boolean
}) {
  return (
    <div className={cn('flex flex-col gap-0.5 py-1.5', className)}>
      <dt className="text-faint text-[11px] tracking-wide uppercase">{label}</dt>
      <dd className={cn('text-foreground text-sm break-all', mono && 'font-mono text-[13px]')}>
        {children}
      </dd>
    </div>
  )
}

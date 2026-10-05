import { cn } from '@/shared/lib/cn'

/** Spinner used for inline loading affordances. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        'border-border-strong border-t-accent inline-block size-3.5 shrink-0 animate-[ah-spin_700ms_linear_infinite] rounded-full border-2',
        className,
      )}
    />
  )
}

/** Skeleton block used while a view loads. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'bg-surface-2 relative block overflow-hidden rounded-md',
        'after:via-surface-3 after:absolute after:inset-0 after:animate-[ah-shimmer_1.6s_ease-in-out_infinite] after:bg-gradient-to-r after:from-transparent after:to-transparent',
        className,
      )}
    />
  )
}

/** Animated loading placeholder for a list of cards. */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="border-border bg-surface flex items-center gap-4 rounded-xl border p-4"
        >
          <Skeleton className="size-10 rounded-lg" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  )
}

import { cn } from '@/shared/lib/cn'

/**
 * A determinate progress bar: how much of `max` the `value` fills.
 *
 * Drawn from design tokens only — the accent fill on the recessed `surface-3` track — so an accent
 * chosen in Settings is what it is painted with. The bar carries the accessible value itself
 * (`role="progressbar"` with `aria-valuenow/min/max`), so a caller shows its own label beside it
 * rather than hiding the number in a title. Widths animate through the theme's own easing, which
 * `prefers-reduced-motion` turns off with the rest of the layout transitions.
 */
export function Progress({
  value,
  max = 100,
  label,
  size = 'sm',
  className,
}: {
  /** The filled amount, clamped to `0..max`. */
  value: number
  max?: number
  /** Accessible name for a bar that has no visible label of its own. */
  label?: string
  size?: 'sm' | 'md'
  className?: string
}) {
  const bounded = Math.min(Math.max(value, 0), max)
  const percent = max > 0 ? (bounded / max) * 100 : 0

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={bounded}
      aria-label={label}
      className={cn(
        'bg-surface-3 w-full overflow-hidden rounded-full',
        size === 'sm' ? 'h-1.5' : 'h-2.5',
        className,
      )}
    >
      <div
        className="bg-accent ease-warm h-full rounded-full transition-[width] duration-300"
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

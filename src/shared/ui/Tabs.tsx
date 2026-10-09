import * as TabsPrimitive from '@radix-ui/react-tabs'
import { useLayoutEffect, useRef, useState, type ComponentProps } from 'react'

import { cn } from '@/shared/lib/cn'

export const Tabs = TabsPrimitive.Root

interface IndicatorRect {
  left: number
  width: number
}

/**
 * How a tab list is drawn.
 *
 * `primary` is the page's own tab row: a bottom rule, with an accent underline that glides under
 * the active tab. `secondary` is a tab row *inside* another one — a compact segmented control on
 * an inset surface, its active tab a raised pill — so the two levels are never mistaken for each
 * other. The secondary list paints its pill on the active trigger itself rather than with the
 * measured indicator: a segmented control may scroll or wrap, and an absolutely placed bar behind
 * it would be clipped by one and stretched by the other.
 */
export type TabsListVariant = 'primary' | 'secondary'

/** The accent underline that glides between the tabs of a primary list. */
function ActiveIndicator({ rect, animated }: { rect: IndicatorRect | null; animated: boolean }) {
  if (!rect) return null

  return (
    <span
      aria-hidden
      style={{ width: rect.width, transform: `translateX(${rect.left}px)` }}
      className={cn(
        'bg-accent pointer-events-none absolute -bottom-px left-0 h-0.5 rounded-full',
        animated && 'ease-warm transition-[width,transform] duration-200',
      )}
    />
  )
}

export function TabsList({
  className,
  variant = 'primary',
  children,
  ...props
}: ComponentProps<typeof TabsPrimitive.List> & { variant?: TabsListVariant }) {
  const listRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<IndicatorRect | null>(null)
  const [animated, setAnimated] = useState(false)

  // Measured here rather than in the indicator: a sibling's layout effect runs *before* the
  // ref Radix forwards to the list is attached, so it would always see a null element. Only the
  // primary variant needs it — a secondary list paints its pill on the trigger itself.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list || variant !== 'primary') return

    const measure = () => {
      const active = list.querySelector<HTMLElement>('[data-state="active"]')
      setRect(active ? { left: active.offsetLeft, width: active.offsetWidth } : null)
    }

    measure()
    // The first placement must not slide in from the left edge of the list.
    const frame = window.requestAnimationFrame(() => setAnimated(true))
    // Radix flips `data-state` on the triggers; that is what moves the bar.
    const mutations = new MutationObserver(measure)
    mutations.observe(list, { attributes: true, attributeFilter: ['data-state'], subtree: true })
    const resize = new ResizeObserver(measure)
    resize.observe(list)

    return () => {
      window.cancelAnimationFrame(frame)
      mutations.disconnect()
      resize.disconnect()
    }
  }, [variant])

  return (
    <TabsPrimitive.List
      ref={listRef}
      data-variant={variant}
      className={cn(
        'group/tabs relative flex items-center',
        // The primary row is the page's own: a rule under it, tabs spaced along it. The secondary
        // row is a segmented control instead — an inset surface that hugs its tabs, no rule.
        variant === 'secondary'
          ? 'border-border bg-surface-2 w-fit max-w-full gap-0.5 overflow-x-auto rounded-lg border p-0.5'
          : 'border-border gap-1 border-b',
        className,
      )}
      {...props}
    >
      {children}
      {variant === 'primary' ? <ActiveIndicator rect={rect} animated={animated} /> : null}
    </TabsPrimitive.List>
  )
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        // `relative` keeps a trigger above the absolutely placed indicator of a primary list.
        'text-muted ease-warm relative px-3 py-2 text-sm transition-colors duration-150',
        'hover:text-foreground focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-2',
        'data-[state=active]:text-foreground',
        // In a secondary list the active tab is a raised pill, not an underline: the trigger is
        // smaller, takes its own corners, and carries the pill itself — every trigger keeps a
        // transparent border so switching never shifts the row by a pixel.
        'group-data-[variant=secondary]/tabs:rounded-md group-data-[variant=secondary]/tabs:border',
        'group-data-[variant=secondary]/tabs:border-transparent group-data-[variant=secondary]/tabs:px-2.5',
        'group-data-[variant=secondary]/tabs:py-1 group-data-[variant=secondary]/tabs:text-[0.8125rem]',
        'group-data-[variant=secondary]/tabs:hover:bg-surface/70',
        'group-data-[variant=secondary]/tabs:data-[state=active]:border-border',
        'group-data-[variant=secondary]/tabs:data-[state=active]:bg-surface',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn(
        'pt-5 focus-visible:outline-none',
        // Radix keeps inactive panels mounted and only flips `data-state`, so this
        // animation restarts on every switch.
        'data-[state=active]:animate-[ah-rise_200ms_var(--ease-warm)_both]',
        className,
      )}
      {...props}
    />
  )
}

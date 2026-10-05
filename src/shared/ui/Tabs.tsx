import * as TabsPrimitive from '@radix-ui/react-tabs'
import { useLayoutEffect, useRef, useState, type ComponentProps } from 'react'

import { cn } from '@/shared/lib/cn'

export const Tabs = TabsPrimitive.Root

interface IndicatorRect {
  left: number
  width: number
}

/** The accent underline that glides between tabs. */
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
  children,
  ...props
}: ComponentProps<typeof TabsPrimitive.List>) {
  const listRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<IndicatorRect | null>(null)
  const [animated, setAnimated] = useState(false)

  // Measured here rather than in the indicator: a sibling's layout effect runs *before* the
  // ref Radix forwards to the list is attached, so it would always see a null element.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return

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
  }, [])

  return (
    <TabsPrimitive.List
      ref={listRef}
      className={cn('border-border relative flex items-center gap-1 border-b', className)}
      {...props}
    >
      {children}
      <ActiveIndicator rect={rect} animated={animated} />
    </TabsPrimitive.List>
  )
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'text-muted ease-warm px-3 py-2 text-sm transition-colors duration-150',
        'hover:text-foreground focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-2',
        'data-[state=active]:text-foreground',
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

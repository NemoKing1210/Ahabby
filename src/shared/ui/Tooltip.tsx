import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'

/**
 * Tooltip with a one-node API. Radix requires a single provider at the app root
 * (`app/providers.tsx`); this wrapper keeps call sites terse.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  if (content === null || content === undefined || content === '') {
    return <>{children}</>
  }
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="border-border bg-surface text-foreground shadow-popover z-50 max-w-xs animate-[ah-fade-in_120ms_ease-out] rounded-lg border px-2.5 py-1.5 text-[0.75rem] data-[state=closed]:animate-[ah-fade-out_90ms_ease-in]"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

export const TooltipProvider = TooltipPrimitive.Provider

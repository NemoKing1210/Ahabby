import type { HTMLAttributes } from 'react'

import { cn } from '@/shared/lib/cn'

/**
 * A page's heading, pinned to the top of the scrolling column.
 *
 * The negative margins cancel the padding this header adds for when it is stuck (`pt-4`
 * above the title, `pb-3` below it) and bleed the blurred backdrop over the column's
 * horizontal padding, so the resting layout is byte-for-byte what a plain `<header>` gave.
 */
export function PageHeader({ className, children, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <header
      className={cn(
        'bg-background/85 sticky top-0 z-20 -mx-8 -mt-4 -mb-3 px-8 pt-4 pb-3 backdrop-blur-md',
        className,
      )}
      {...props}
    >
      {children}
    </header>
  )
}

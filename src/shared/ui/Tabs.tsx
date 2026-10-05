import * as TabsPrimitive from '@radix-ui/react-tabs'
import type { ComponentProps } from 'react'

import { cn } from '@/shared/lib/cn'

export const Tabs = TabsPrimitive.Root

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('border-border flex items-center gap-1 border-b', className)}
      {...props}
    />
  )
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'text-muted ease-warm -mb-px border-b-2 border-transparent px-3 py-2 text-sm transition-colors duration-150',
        'hover:text-foreground focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-2',
        'data-[state=active]:border-accent data-[state=active]:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn('pt-5 focus-visible:outline-none', className)}
      {...props}
    />
  )
}

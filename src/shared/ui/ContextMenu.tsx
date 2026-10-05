import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import type { ComponentProps } from 'react'

import { cn } from '@/shared/lib/cn'

/**
 * Right-click menu, wearing the same tokens as the dialogs.
 *
 * Radix owns the parts that are easy to get wrong — placement at the pointer with collision
 * avoidance, roving focus, typeahead, the keyboard context-menu key, dismissal, scroll lock —
 * so every menu in the app is one of these. The content animates in but has no exit animation
 * on purpose: Radix restores focus to the trigger when the content unmounts, and a delayed
 * unmount would race a dialog that a menu item just opened.
 */
export const ContextMenu = ContextMenuPrimitive.Root

export const ContextMenuTrigger = ContextMenuPrimitive.Trigger

const ITEM_BASE =
  'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[0.8125rem] outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-faint'

export function ContextMenuContent({
  className,
  collisionPadding = 8,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        collisionPadding={collisionPadding}
        className={cn(
          'border-border bg-surface shadow-popover z-50 max-h-[var(--radix-context-menu-content-available-height)] min-w-52 overflow-y-auto rounded-xl border p-1 outline-none',
          'origin-[var(--radix-context-menu-content-transform-origin)] data-[state=open]:animate-[ah-menu-in_140ms_var(--ease-warm)]',
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

export function ContextMenuItem({
  className,
  destructive = false,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Item> & { destructive?: boolean }) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        ITEM_BASE,
        destructive
          ? 'text-danger-fg data-[highlighted]:bg-danger/12 [&_svg]:text-danger-fg'
          : 'text-foreground data-[highlighted]:bg-surface-2',
        className,
      )}
      {...props}
    />
  )
}

/** Non-interactive heading at the top of a menu, e.g. which card was right-clicked. */
export function ContextMenuLabel({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Label>) {
  return (
    <ContextMenuPrimitive.Label
      className={cn('text-faint truncate px-2.5 py-1.5 text-[0.6875rem] tracking-wide', className)}
      {...props}
    />
  )
}

export function ContextMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator className={cn('bg-border my-1 h-px', className)} {...props} />
  )
}

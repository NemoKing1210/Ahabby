import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import * as SeparatorPrimitive from '@radix-ui/react-separator'
import { X } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/shared/lib/cn'

import { Button } from './Button'

export const Dialog = DialogPrimitive.Root

/**
 * Modal dialog with the project's visual language: thin border, no heavy shadow, and a
 * scrollable body so long diffs stay usable.
 */
export function DialogContent({
  className,
  children,
  footer,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { footer?: ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="bg-overlay fixed inset-0 z-40 animate-[ah-fade-in_150ms_ease-out]" />
      <DialogPrimitive.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[min(760px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col',
          'border-border bg-surface shadow-popover rounded-2xl border outline-none',
          className,
        )}
        {...props}
      >
        {children}
        {footer ? (
          <div className="border-border flex items-center justify-end gap-2 border-t px-6 py-4">
            {footer}
          </div>
        ) : null}
        <DialogPrimitive.Close asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute top-4 right-4"
            aria-label="Close"
          >
            <X className="size-4" />
          </Button>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 px-6 pt-6 pb-4', className)} {...props} />
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('text-lg', className)} {...props} />
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description className={cn('text-muted text-[13px]', className)} {...props} />
  )
}

export function DialogBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto px-6 pb-5', className)} {...props} />
}

export function Separator({ className, ...props }: ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      decorative
      orientation="horizontal"
      className={cn('bg-border h-px w-full', className)}
      {...props}
    />
  )
}

export function ScrollArea({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <ScrollAreaPrimitive.Root className={cn('relative overflow-hidden', className)}>
      <ScrollAreaPrimitive.Viewport className="size-full">{children}</ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation="vertical"
        className="flex w-2.5 touch-none p-0.5 select-none"
      >
        <ScrollAreaPrimitive.Thumb className="bg-border-strong flex-1 rounded-full" />
      </ScrollAreaPrimitive.Scrollbar>
    </ScrollAreaPrimitive.Root>
  )
}

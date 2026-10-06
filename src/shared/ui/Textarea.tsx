import type { TextareaHTMLAttributes } from 'react'

import { cn } from '@/shared/lib/cn'

/**
 * Multi-line text field of the design system: same border, surface and focus ring as
 * [`Input`](./Input.tsx), sized by the caller. Used by the creation forms (a skill body, one
 * argument per line, `KEY=value` rows) — the caller decides whether the content is prose or
 * something machine-shaped (`className="font-mono"`).
 */
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'border-border bg-surface text-foreground w-full resize-y rounded-lg border px-2.5 py-2 text-[0.8125rem] leading-relaxed',
        'placeholder:text-faint focus:outline-ring outline-none focus:outline-2 focus:outline-offset-2 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

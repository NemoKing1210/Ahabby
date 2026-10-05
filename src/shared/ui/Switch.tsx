import * as SwitchPrimitive from '@radix-ui/react-switch'
import type { ComponentProps } from 'react'

import { cn } from '@/shared/lib/cn'

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer border-border bg-surface-3 ease-warm inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent',
        'focus-visible:outline-ring outline-none focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'bg-surface ease-warm pointer-events-none block size-3.5 translate-x-0.5 rounded-full shadow-none transition-transform duration-150',
          'data-[state=checked]:bg-accent-foreground data-[state=checked]:translate-x-4',
        )}
      />
    </SwitchPrimitive.Root>
  )
}

/** A switch with a label and an explanatory line, as used in Settings. */
export function SwitchField({
  label,
  hint,
  checked,
  onCheckedChange,
  id,
}: {
  label: string
  hint?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  id: string
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-foreground text-sm">
          {label}
        </label>
        {hint ? <p className="text-muted max-w-prose text-[13px]">{hint}</p> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

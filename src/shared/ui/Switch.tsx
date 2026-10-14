import * as SwitchPrimitive from '@radix-ui/react-switch'
import type { ComponentProps } from 'react'

import { cn } from '@/shared/lib/cn'

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        // The track: a small pill that sits recessed while off and takes the accent with a soft
        // halo while on, so the state reads from across the card.
        'group ease-warm inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-[background-color,border-color,box-shadow,scale] duration-150',
        'border-border bg-surface-3 hover:border-border-strong shadow-[inset_0_1px_2px_color-mix(in_oklab,var(--color-foreground)_9%,transparent)]',
        'data-[state=checked]:border-accent data-[state=checked]:from-accent data-[state=checked]:to-accent-hover data-[state=checked]:bg-gradient-to-b',
        'data-[state=checked]:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-accent)_14%,transparent)]',
        'focus-visible:outline-ring outline-none focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          // The knob: a raised bead with a contact shadow and a hairline edge, which is what the
          // track's recess and the accent's halo are there to set off.
          'bg-surface ease-warm pointer-events-none block size-3.5 translate-x-0.5 rounded-full transition-[translate,scale,background-color] duration-150',
          'shadow-[0_1px_2px_color-mix(in_oklab,var(--color-foreground)_25%,transparent),0_0_0_1px_color-mix(in_oklab,var(--color-foreground)_8%,transparent)]',
          'group-active:scale-90 data-[state=checked]:translate-x-4',
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
  disabled = false,
}: {
  label: string
  hint?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  id: string
  /** Dims the row and locks the switch — for a setting another one has to be on first. */
  disabled?: boolean
}) {
  return (
    <div className={cn('flex items-start justify-between gap-6 py-3', disabled && 'opacity-60')}>
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-foreground text-sm">
          {label}
        </label>
        {hint ? <p className="text-muted max-w-prose text-[0.8125rem]">{hint}</p> : null}
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  )
}

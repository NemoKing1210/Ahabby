import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'

import { cn } from '@/shared/lib/cn'

export interface SelectOption {
  value: string
  label: string
}

/** Small, accessible select used for filters and settings. */
export function Select({
  value,
  onValueChange,
  options,
  className,
  ariaLabel,
  placeholder,
}: {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  className?: string
  ariaLabel: string
  placeholder?: string
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          'border-border bg-surface text-foreground inline-flex h-9 items-center justify-between gap-2 rounded-lg border px-3 text-sm',
          'ease-warm hover:bg-surface-2 focus-visible:outline-ring transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2',
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown className="text-faint size-3.5" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="border-border bg-surface shadow-popover z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className={cn(
                  'text-foreground flex cursor-default items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-sm outline-none',
                  'data-[highlighted]:bg-surface-2 data-[state=checked]:text-accent-strong',
                )}
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator>
                  <Check className="size-3.5" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

import type { ReactNode } from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'

import { cn } from '@/shared/lib/cn'

export interface SelectOption {
  value: string
  label: string
  /**
   * Leading visual — an agent's brand tile, mostly. It is painted in the closed trigger and in
   * the option's own row, so the logo identifies the selection before the label is read.
   */
  icon?: ReactNode
  /** Dimmed note at the right of the row (a count, a version). The trigger leaves it out. */
  description?: string
  disabled?: boolean
}

/**
 * Small, accessible select used for filters, agent pickers and settings.
 *
 * The trigger paints the selected option itself rather than through Radix's `Select.Value`:
 * that node drops the `className` it is given, which would leave a tile glued to the label and
 * give the label nothing to truncate against. `SelectItemText` drops its `className` too, so a
 * row's spacing lives in a wrapper of our own (the item's own gap only separates that wrapper
 * from the note and the check mark).
 */
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
  const selected = options.find((option) => option.value === value)

  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          'border-border bg-surface text-foreground inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm',
          'ease-warm hover:bg-surface-2 focus-visible:outline-ring transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2',
          className,
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {selected ? (
            <>
              {selected.icon}
              <span className="truncate">{selected.label}</span>
            </>
          ) : (
            <span className="text-faint truncate">{placeholder}</span>
          )}
        </span>
        <SelectPrimitive.Icon className="shrink-0">
          <ChevronDown className="text-faint size-3.5" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="border-border bg-surface shadow-popover z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border data-[state=closed]:animate-[ah-fade-out_100ms_ease-in] data-[state=open]:animate-[ah-fade-in_120ms_ease-out]"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={cn(
                  'text-foreground flex cursor-pointer items-center gap-3 rounded-sm px-2.5 py-1.5 text-sm outline-none',
                  'data-[highlighted]:bg-surface-2 data-[state=checked]:text-accent-strong',
                  'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                )}
              >
                <SelectPrimitive.ItemText>
                  <span className="flex items-center gap-2">
                    {option.icon}
                    <span>{option.label}</span>
                  </span>
                </SelectPrimitive.ItemText>
                <span className="ml-auto flex shrink-0 items-center gap-3">
                  {option.description ? (
                    <span className="text-faint max-w-32 truncate text-[0.6875rem] tabular-nums">
                      {option.description}
                    </span>
                  ) : null}
                  <SelectPrimitive.ItemIndicator className="shrink-0">
                    <Check className="size-3.5" />
                  </SelectPrimitive.ItemIndicator>
                </span>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

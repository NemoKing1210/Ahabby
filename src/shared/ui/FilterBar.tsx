import type { ComponentPropsWithRef, ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/shared/lib/cn'

import { Button } from './Button'
import { Input } from './Input'

/**
 * The strip of controls above a list — the one place a screen narrows what it shows.
 *
 * Every screen that filters wears the same one, and the same control sits in the same place on all
 * of them: the inputs (the search box, the selects, the action that acts on the whole list) on the
 * first row, the chip groups under them, the tags last. It is a single inset surface, which is what
 * tells a filter apart from the cards it filters — an inset strip of controls, then the raised list.
 */
export function FilterBar({ className, children, ...props }: ComponentPropsWithRef<'div'>) {
  return (
    <div
      className={cn(
        'border-border bg-surface-2/40 flex flex-col gap-3 rounded-xl border p-3.5',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

/** One wrapping row of the strip. Rows carry the roomy gap; a group's own chips stay tight. */
export function FilterRow({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2', className)}>{children}</div>
  )
}

/** A chip group's caption — the uppercase word the chips of one axis hang under. */
export function FilterCaption({ children }: { children: ReactNode }) {
  return <span className="text-faint text-[0.6875rem] tracking-wide uppercase">{children}</span>
}

/**
 * A group of chips with its own caption.
 *
 * The caption is what separates one group from the next, never a rule between them: a divider
 * drawn through a row that wraps opens the next line with a stray tick, while a word plus the roomy
 * gap already read as a new group. `ariaLabel` is where a group needs a fuller name than the
 * caption on screen.
 */
export function FilterChipGroup({
  label,
  ariaLabel,
  className,
  children,
}: {
  label: string
  ariaLabel?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel ?? label}
      className={cn('flex flex-wrap items-center gap-1.5', className)}
    >
      <FilterCaption>{label}</FilterCaption>
      {children}
    </div>
  )
}

/**
 * The one search box: same icon, same width, same way to empty it. It is labelled `Search` wherever
 * it stands — the placeholder says what this screen searches — and the clear control appears only
 * once there is something to clear, so an untouched strip stays quiet.
 */
export function FilterSearch({
  value,
  onValueChange,
  placeholder,
  className,
}: {
  value: string
  onValueChange: (value: string) => void
  placeholder: string
  className?: string
}) {
  const { t } = useTranslation()

  return (
    <Input
      className={cn('w-full sm:w-64', className)}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      placeholder={placeholder}
      aria-label={t('common.search')}
      leading={<Search className="size-3.5" aria-hidden />}
      trailing={
        value.length > 0 ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="-mr-1.5 size-6"
            aria-label={t('common.clearSearch')}
            onClick={() => onValueChange('')}
          >
            <X className="size-3.5" />
          </Button>
        ) : null
      }
    />
  )
}

/**
 * The way out of a filter that emptied the list: the same button, at the same end of the first row,
 * on every screen. It only exists while something is narrowing the list, so a strip nobody has
 * touched offers no dead control.
 */
export function FilterClear({ onClick, className }: { onClick: () => void; className?: string }) {
  const { t } = useTranslation()

  return (
    <Button variant="ghost" size="sm" className={cn('ml-auto', className)} onClick={onClick}>
      <X className="size-3.5" aria-hidden />
      {t('common.clearFilters')}
    </Button>
  )
}

import { useTranslation } from 'react-i18next'

import type { Manager } from '@/shared/bindings/Manager'
import { cn } from '@/shared/lib/cn'

import { Badge, type BadgeProps } from './Badge'
import { MANAGER_BRANDS, MANAGER_NAME_KEY } from './managerBrands'

/**
 * Avatar tile for a package manager.
 *
 * `managerBrands.ts` gives every manager the same shape an agent's brand has: a tile in the
 * manager's own colour with its mark in a contrasting one. The two that are not products — an
 * official install script and a manual install — keep the neutral surface tile, so no colour is
 * invented for them.
 *
 * A tile is how a manager is recognised on its own (a picker, the managers list of the
 * settings); where a manager is metadata of something else, `ManagerBadge` carries the same tile
 * in a chip next to the manager's name.
 */
const SIZES = {
  xs: { tile: 'size-4 rounded-[4px]', edge: 16 },
  sm: { tile: 'size-5 rounded-[5px]', edge: 20 },
  md: { tile: 'size-8 rounded-lg', edge: 32 },
} as const

const TILE =
  'inline-flex shrink-0 items-center justify-center overflow-hidden border border-black/10 dark:border-white/10'

export function ManagerIcon({
  manager,
  size = 'md',
  className,
}: {
  manager: Manager
  size?: keyof typeof SIZES
  className?: string
}) {
  const { tile, edge } = SIZES[size]
  const brand = MANAGER_BRANDS[manager]
  const mark = Math.round(edge * brand.multiple)
  const bare = brand.background === null

  return (
    <span
      aria-hidden
      className={cn(TILE, tile, bare && 'border-border bg-surface-2 text-muted', className)}
      style={
        bare
          ? undefined
          : { backgroundColor: brand.background ?? undefined, color: brand.foreground ?? undefined }
      }
    >
      {brand.path ? (
        <svg viewBox="0 0 24 24" width={mark} height={mark} fill="currentColor">
          <path d={brand.path} />
        </svg>
      ) : brand.Glyph ? (
        <brand.Glyph size={mark} />
      ) : null}
    </span>
  )
}

/** A manager named inside a row about something else: its tile, then the name it goes by. */
export function ManagerBadge({
  manager,
  tone = 'outline',
  className,
}: {
  manager: Manager
  tone?: BadgeProps['tone']
  className?: string
}) {
  const { t } = useTranslation()

  return (
    <Badge tone={tone} className={cn('gap-1 pl-1', className)}>
      <ManagerIcon manager={manager} size="xs" />
      {t(MANAGER_NAME_KEY[manager])}
    </Badge>
  )
}

import { cn } from '@/shared/lib/cn'

import { AGENT_BRANDS } from './agentBrands'

/**
 * Avatar tile for an agent.
 *
 * The manifest's `icon` key selects a brand palette from `agentBrands.ts`: the tile takes the
 * brand's own background and the mark (or, without one, the initials) is drawn in the brand's
 * contrasting colour. Keys without a palette — user manifests, mostly — fall back to a neutral
 * monogram tile, so an unknown agent never gets a made-up colour.
 */
const SIZES = {
  sm: { tile: 'size-8 text-[0.8125rem]', edge: 32 },
  md: { tile: 'size-10 text-[0.9375rem]', edge: 40 },
  lg: { tile: 'size-14 text-xl', edge: 56 },
} as const

const TILE =
  'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-black/10 dark:border-white/10'

function initials(name: string): string {
  const letters = name
    .split(/[\s-_]+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
  return letters.length > 0 ? letters : '·'
}

export function AgentIcon({
  name,
  icon,
  size = 'md',
  className,
}: {
  name: string
  /** Manifest `icon` key; selects the brand palette when one is mapped. */
  icon?: string | null
  size?: keyof typeof SIZES
  className?: string
}) {
  const { tile, edge } = SIZES[size]
  const brand = icon ? AGENT_BRANDS[icon] : undefined

  if (brand) {
    return (
      <span
        aria-hidden
        className={cn(TILE, tile, className)}
        style={{ backgroundColor: brand.background, color: brand.foreground }}
      >
        {brand.Logo ? (
          <brand.Logo size={Math.round(edge * brand.multiple)} />
        ) : (
          <span className="font-serif font-medium">{initials(name)}</span>
        )}
      </span>
    )
  }

  return (
    <span
      aria-hidden
      className={cn(
        TILE,
        'border-border bg-surface-2 text-muted font-serif font-medium',
        tile,
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}

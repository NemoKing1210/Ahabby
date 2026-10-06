import type { ReactNode } from 'react'
import { FolderGit2, Layers } from 'lucide-react'

import { cn } from '@/shared/lib/cn'
import { isProjectOwner, isSharedOwner } from '@/shared/lib/owners'

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
  xs: { tile: 'size-5 rounded-[5px] text-[0.625rem]', edge: 20 },
  sm: { tile: 'size-8 text-[0.8125rem]', edge: 32 },
  md: { tile: 'size-10 text-[0.9375rem]', edge: 40 },
  lg: { tile: 'size-14 text-xl', edge: 56 },
} as const

const TILE =
  'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-black/10 dark:border-white/10'

/**
 * The icon slot of a picker row that stands for no agent ("all"): a neutral tile of the same
 * size as an `xs` `AgentIcon`, so the column of agent logos stays straight.
 */
export function NeutralTile({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(TILE, 'border-border bg-surface-2 text-muted', SIZES.xs.tile, className)}
    >
      {children}
    </span>
  )
}

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
  ownerId,
  size = 'md',
  className,
}: {
  name: string
  /** Manifest `icon` key; selects the brand palette when one is mapped. */
  icon?: string | null
  /** Owner id; the agent-neutral shared surface gets its own tile instead of a monogram. */
  ownerId?: string
  size?: keyof typeof SIZES
  className?: string
}) {
  const { tile, edge } = SIZES[size]

  if (ownerId && isSharedOwner(ownerId)) {
    return (
      <span
        aria-hidden
        className={cn(TILE, 'border-border bg-surface-2 text-accent-strong', tile, className)}
      >
        <Layers size={Math.round(edge * 0.6)} />
      </span>
    )
  }

  // A project is the user's own directory, not a product: it never gets a brand colour or a
  // monogram, only the neutral tile with a folder mark.
  if (ownerId && isProjectOwner(ownerId)) {
    return (
      <span
        aria-hidden
        className={cn(TILE, 'border-border bg-surface-2 text-muted', tile, className)}
      >
        <FolderGit2 size={Math.round(edge * 0.6)} />
      </span>
    )
  }

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

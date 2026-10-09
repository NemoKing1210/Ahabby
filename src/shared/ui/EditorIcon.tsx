import { cn } from '@/shared/lib/cn'

import { EDITOR_BRANDS, UNKNOWN_EDITOR_BRAND } from './editorBrands'

/**
 * Avatar tile for an external editor.
 *
 * The same shape a manager's or an agent's brand has — a tile in the editor's own colour with its
 * mark in a contrasting one — so a picker's row is recognised by its logo before the name is
 * read. An id without a brand keeps the neutral surface tile rather than inventing a colour.
 */
const SIZES = {
  xs: { tile: 'size-4 rounded-[4px]', edge: 16 },
  sm: { tile: 'size-5 rounded-[5px]', edge: 20 },
  md: { tile: 'size-8 rounded-lg', edge: 32 },
} as const

const TILE =
  'inline-flex shrink-0 items-center justify-center overflow-hidden border border-black/10 dark:border-white/10'

export function EditorIcon({
  editor,
  size = 'md',
  className,
}: {
  /** The editor id the backend reported, which is also its brand key. */
  editor: string
  size?: keyof typeof SIZES
  className?: string
}) {
  const { tile, edge } = SIZES[size]
  const brand = EDITOR_BRANDS[editor] ?? UNKNOWN_EDITOR_BRAND
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
        <svg
          viewBox={brand.viewBox ?? '0 0 24 24'}
          width={mark}
          height={mark}
          fill="currentColor"
          fillRule={brand.fillRule}
        >
          <path d={brand.path} />
        </svg>
      ) : brand.Glyph ? (
        <brand.Glyph size={mark} />
      ) : null}
    </span>
  )
}

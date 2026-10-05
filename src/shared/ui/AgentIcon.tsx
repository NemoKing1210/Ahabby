import { cn } from '@/shared/lib/cn'

/**
 * Monogram tile for an agent.
 *
 * Ahabby deliberately does **not** ship the logos of the tools it manages (they are
 * trademarked assets with their own licences): a deterministic warm monogram keeps the list
 * recognisable without borrowing anyone's brand.
 */
const PALETTE = [
  'bg-[#d97757]/15 text-[#b0512f] dark:text-[#e08a69]',
  'bg-[#788c5d]/15 text-[#5f7048] dark:text-[#a3b884]',
  'bg-[#6a9bcc]/15 text-[#4a79a8] dark:text-[#8cb4dc]',
  'bg-[#c08a3e]/18 text-[#8a6122] dark:text-[#ddb172]',
  'bg-[#8a7f6a]/18 text-[#6b6252] dark:text-[#c2b8a4]',
] as const

const SIZES = {
  sm: 'size-8 text-[13px]',
  md: 'size-10 text-[15px]',
  lg: 'size-14 text-xl',
} as const

function hash(value: string): number {
  let result = 0
  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) | 0
  }
  return Math.abs(result)
}

export function AgentIcon({
  id,
  name,
  size = 'md',
  className,
}: {
  id: string
  name: string
  size?: keyof typeof SIZES
  className?: string
}) {
  const palette = PALETTE[hash(id) % PALETTE.length] ?? PALETTE[0]
  const initials = name
    .split(/[\s-_]+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg font-serif font-medium',
        SIZES[size],
        palette,
        className,
      )}
    >
      {initials.length > 0 ? initials : '·'}
    </span>
  )
}

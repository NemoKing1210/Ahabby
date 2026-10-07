import { useId } from 'react'

import { cn } from '@/shared/lib/cn'

type AhabbyLogoProps = {
  className?: string
  label?: string
}

/**
 * Ahabby's mark: two connected paths form an A-shaped hub, with the small node at the apex
 * standing for the place where the machine's agents meet. Keep the geometry here in sync with
 * `src-tauri/icons/ahabby.svg`, the source used for the native app icons and tray icon.
 */
export function AhabbyLogo({ className, label }: AhabbyLogoProps) {
  const id = useId().replaceAll(':', '')
  const backgroundId = `ahabby-logo-background-${id}`
  const markId = `ahabby-logo-mark-${id}`

  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        'inline-flex aspect-square shrink-0 overflow-hidden rounded-[28%] shadow-[0_10px_28px_-18px_rgb(21_22_27/0.9)]',
        className,
      )}
    >
      <svg viewBox="0 0 100 100" className="size-full" focusable="false">
        <defs>
          <linearGradient
            id={backgroundId}
            x1="18"
            y1="10"
            x2="84"
            y2="92"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#2c2d35" />
            <stop offset="1" stopColor="#151619" />
          </linearGradient>
          <linearGradient
            id={markId}
            x1="24"
            y1="76"
            x2="77"
            y2="22"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#ff8466" />
            <stop offset="0.48" stopColor="#ffb36b" />
            <stop offset="1" stopColor="#a78bfa" />
          </linearGradient>
        </defs>
        <rect width="100" height="100" rx="28" fill={`url(#${backgroundId})`} />
        <path
          d="M27 72 L43 31 Q50 13 57 31 L73 72"
          fill="none"
          stroke={`url(#${markId})`}
          strokeWidth="14"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M37 56 C44 53 56 53 63 56"
          fill="none"
          stroke={`url(#${markId})`}
          strokeWidth="12"
          strokeLinecap="round"
        />
        <circle cx="50" cy="28" r="3.6" fill="#fff8ef" />
      </svg>
    </span>
  )
}

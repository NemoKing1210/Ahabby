import type { ReactNode } from 'react'

import type { Language } from '@/shared/i18n'
import { cn } from '@/shared/lib/cn'

/**
 * Country flag for a UI language, drawn as a rounded tile the same size as an `xs` agent icon
 * so the language select lines up with every other picker.
 *
 * SVG (not emoji): Windows often renders regional-indicator pairs as letters instead of flags.
 */
const FLAG: Record<Language, { title: string; mark: ReactNode }> = {
  en: {
    title: 'United States',
    mark: (
      <svg viewBox="0 0 60 40" className="size-full" aria-hidden>
        <rect width="60" height="40" fill="#b22234" />
        <path
          fill="#fff"
          d="M0 3.08h60v3.08H0zm0 6.15h60v3.08H0zm0 6.15h60v3.08H0zm0 6.16h60v3.08H0zm0 6.15h60v3.08H0zm0 6.15h60v3.08H0z"
        />
        <rect width="24" height="21.54" fill="#3c3b6e" />
      </svg>
    ),
  },
  ru: {
    title: 'Russia',
    mark: (
      <svg viewBox="0 0 60 40" className="size-full" aria-hidden>
        <rect width="60" height="40" fill="#fff" />
        <rect y="13.33" width="60" height="13.34" fill="#0039a6" />
        <rect y="26.67" width="60" height="13.33" fill="#d52b1e" />
      </svg>
    ),
  },
  zh: {
    title: 'China',
    mark: (
      <svg viewBox="0 0 60 40" className="size-full" aria-hidden>
        <rect width="60" height="40" fill="#de2910" />
        <polygon
          fill="#ffde00"
          points="12,4 13.76,9.42 19.46,9.42 14.85,12.76 16.61,18.18 12,14.84 7.39,18.18 9.15,12.76 4.54,9.42 10.24,9.42"
        />
      </svg>
    ),
  },
  es: {
    title: 'Spain',
    mark: (
      <svg viewBox="0 0 60 40" className="size-full" aria-hidden>
        <rect width="60" height="40" fill="#c60b1e" />
        <rect y="10" width="60" height="20" fill="#ffc400" />
      </svg>
    ),
  },
  de: {
    title: 'Germany',
    mark: (
      <svg viewBox="0 0 60 40" className="size-full" aria-hidden>
        <rect width="60" height="40" fill="#000" />
        <rect y="13.33" width="60" height="13.34" fill="#d00" />
        <rect y="26.67" width="60" height="13.33" fill="#ffce00" />
      </svg>
    ),
  },
  ja: {
    title: 'Japan',
    mark: (
      <svg viewBox="0 0 60 40" className="size-full" aria-hidden>
        <rect width="60" height="40" fill="#fff" />
        <circle cx="30" cy="20" r="9" fill="#bc002d" />
      </svg>
    ),
  },
  fr: {
    title: 'France',
    mark: (
      <svg viewBox="0 0 60 40" className="size-full" aria-hidden>
        <rect width="20" height="40" fill="#002395" />
        <rect x="20" width="20" height="40" fill="#fff" />
        <rect x="40" width="20" height="40" fill="#ed2939" />
      </svg>
    ),
  },
}

export function LanguageFlag({ language, className }: { language: Language; className?: string }) {
  const flag = FLAG[language]
  return (
    <span
      aria-hidden
      title={flag.title}
      className={cn(
        'inline-flex size-5 shrink-0 overflow-hidden rounded-[5px] border border-black/10 dark:border-white/10',
        className,
      )}
    >
      {flag.mark}
    </span>
  )
}

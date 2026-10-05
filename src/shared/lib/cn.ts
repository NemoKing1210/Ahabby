import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Tailwind-aware class name joiner used by every component in `shared/ui`. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

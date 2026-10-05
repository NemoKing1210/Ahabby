import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { cn } from '@/shared/lib/cn'

const buttonStyles = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-[color,background-color,border-color,scale] duration-150 ease-warm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'border-transparent bg-accent text-accent-foreground hover:bg-accent-hover',
        secondary: 'border-border bg-surface text-foreground hover:bg-surface-2',
        subtle: 'border-transparent bg-surface-2 text-foreground hover:bg-surface-3',
        ghost: 'border-transparent text-muted hover:bg-surface-2 hover:text-foreground',
        danger: 'border-transparent bg-danger text-white hover:bg-danger-hover',
        link: 'border-transparent text-accent-strong underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-[0.8125rem]',
        md: 'h-9 px-3.5',
        lg: 'h-10 px-4',
        icon: 'size-9',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonStyles> {
  /** Render the single child element instead of a `<button>` (e.g. a router link). */
  asChild?: boolean
  children?: ReactNode
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button'
  return <Component className={cn(buttonStyles({ variant, size }), className)} {...props} />
}

export { buttonStyles }

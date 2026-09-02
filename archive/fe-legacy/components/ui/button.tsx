import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 active:scale-95",
  {
    variants: {
      variant: {
        default: 'rounded-full bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-md hover:-translate-y-0.5 uppercase tracking-wide-label',
        destructive:
          'rounded-full bg-destructive text-white hover:bg-destructive/90 hover:shadow-md hover:-translate-y-0.5 focus-visible:ring-destructive/50 uppercase tracking-wide-label',
        outline:
          'rounded-full border-2 border-primary bg-transparent text-primary hover:bg-primary/10 hover:border-primary/80 hover:-translate-y-0.5 dark:bg-input/30 dark:border-input dark:hover:bg-input/50 uppercase tracking-wide-label',
        secondary:
          'rounded-full bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:shadow-md hover:-translate-y-0.5 uppercase tracking-wide-label',
        ghost:
          'rounded-full hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:underline rounded-none',
      },
      size: {
        default: 'h-11 px-6 py-2.5 min-h-[44px]', // Better touch target
        sm: 'h-9 rounded-full px-4 has-[>svg]:px-3 min-h-[40px]',
        lg: 'h-13 rounded-full px-8 py-4 text-sm uppercase tracking-wide-label font-semibold min-h-[48px] has-[>svg]:px-6',
        icon: 'size-11 rounded-full min-h-[44px] min-w-[44px]',
        'icon-sm': 'size-9 rounded-full min-h-[36px] min-w-[36px]',
        'icon-lg': 'size-12 rounded-full min-h-[48px] min-w-[48px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

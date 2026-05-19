import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 max-w-full active:scale-[0.99]',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90 hover:shadow-primary/30',
        destructive:
          'bg-destructive text-destructive-foreground shadow-lg shadow-destructive/15 hover:bg-destructive/90',
        outline:
          'border border-input bg-background/70 shadow-sm shadow-black/10 hover:border-primary/50 hover:bg-accent/80 hover:text-accent-foreground hover:shadow-primary/10',
        secondary:
          'border border-border/60 bg-secondary/90 text-secondary-foreground shadow-sm shadow-black/10 hover:border-primary/40 hover:bg-secondary',
        ghost: 'hover:bg-accent/85 hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        gradient:
          'bg-gradient-to-r from-cyan-400 via-blue-500 to-emerald-400 text-white shadow-xl shadow-cyan-500/20 hover:shadow-blue-500/30',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-12 rounded-md px-8 text-base',
        xl: 'h-12 rounded-lg px-6 text-base sm:h-14 sm:px-10',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };

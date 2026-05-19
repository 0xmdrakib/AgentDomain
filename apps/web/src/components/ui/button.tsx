import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 max-w-full active:scale-[0.99]',
  {
    variants: {
      variant: {
        default:
          'border border-primary bg-primary text-primary-foreground shadow-[0_14px_28px_-22px_rgba(20,21,18,0.75)] hover:bg-primary/90 hover:shadow-[0_18px_34px_-24px_rgba(20,21,18,0.82)]',
        destructive:
          'border border-destructive bg-destructive text-destructive-foreground shadow-[0_14px_28px_-22px_rgba(133,38,28,0.55)] hover:bg-destructive/90',
        outline:
          'border border-input bg-card/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.78),0_8px_18px_-16px_rgba(20,21,18,0.38)] hover:border-primary/45 hover:bg-accent/80 hover:text-accent-foreground',
        secondary:
          'border border-border/80 bg-secondary/85 text-secondary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.76),0_8px_18px_-16px_rgba(20,21,18,0.35)] hover:border-primary/35 hover:bg-secondary',
        ghost: 'hover:bg-accent/85 hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        gradient:
          'border border-primary bg-primary text-primary-foreground shadow-[0_16px_34px_-24px_rgba(20,21,18,0.82)] hover:bg-primary/90 hover:shadow-[0_18px_38px_-24px_rgba(20,21,18,0.86)]',
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

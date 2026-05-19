import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors backdrop-blur-sm',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/90 text-primary-foreground shadow-sm shadow-primary/20',
        secondary: 'border-border/60 bg-secondary/80 text-secondary-foreground',
        destructive: 'border-transparent bg-destructive/90 text-destructive-foreground shadow-sm shadow-destructive/20',
        outline: 'border-border/60 bg-background/55 text-foreground',
        success: 'border-emerald-500/25 bg-emerald-500/14 text-emerald-300',
        warning: 'border-amber-500/25 bg-amber-500/14 text-amber-300',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

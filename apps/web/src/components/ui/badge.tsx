import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors backdrop-blur-sm',
  {
    variants: {
      variant: {
        default: 'border-primary/80 bg-primary text-primary-foreground shadow-sm',
        secondary: 'border-border/80 bg-secondary/75 text-secondary-foreground',
        destructive: 'border-destructive/35 bg-destructive/10 text-destructive',
        outline: 'border-border/80 bg-card/50 text-foreground',
        success: 'border-green-900/20 bg-green-900/10 text-green-900',
        warning: 'border-orange-700/25 bg-orange-600/10 text-orange-800',
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

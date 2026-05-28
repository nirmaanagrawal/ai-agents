/**
 * Badge — chips for status, category, grade, etc.
 *
 * Semantic variants so callers can express intent (success / warning
 * / destructive) without baking in colors. New variants added here,
 * never inlined as `bg-red-100 text-red-700` in components.
 */
import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-tight transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-foreground',
        accent: 'border-transparent bg-accent text-accent-foreground',
        success:
          'border-transparent bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]',
        warning:
          'border-transparent bg-[hsl(var(--warning)/0.18)] text-[hsl(var(--warning))]',
        destructive:
          'border-transparent bg-[hsl(var(--destructive)/0.15)] text-[hsl(var(--destructive))]',
        muted: 'border-transparent bg-muted text-muted-foreground',
      },
      size: {
        default: 'h-5',
        sm: 'h-4 px-1.5 text-[10px]',
        lg: 'h-6 px-3 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

export { Badge, badgeVariants };

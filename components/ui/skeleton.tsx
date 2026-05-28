/**
 * Skeleton — placeholder shimmer for loading states.
 * Used while agent results stream in / before a deploy-bundle loads.
 */
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-muted',
        'relative overflow-hidden',
        'before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer before:bg-gradient-to-r before:from-transparent before:via-foreground/5 before:to-transparent',
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };

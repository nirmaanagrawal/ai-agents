/**
 * Tiny utilities used across UI components.
 *
 * `cn()` is the shadcn-style class-name merger:
 *   - clsx handles conditional + array inputs
 *   - tailwind-merge resolves conflicts intelligently
 *     (e.g. `cn('p-2', 'p-4')` → `'p-4'`).
 *
 * Every UI primitive in `components/ui/*` uses this as its variant
 * resolver — same pattern as shadcn/ui, Vercel Geist, Anthropic
 * Console. Lets parents override base styles cleanly via `className`.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

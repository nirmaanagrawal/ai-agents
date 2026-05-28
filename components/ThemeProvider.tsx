'use client';

/**
 * Wraps `next-themes` ThemeProvider so the rest of the tree can use
 * `useTheme()` without re-importing the provider per file.
 *
 * Mounted in app/layout.tsx at the html root.
 */
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}

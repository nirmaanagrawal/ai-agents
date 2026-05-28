'use client';

/**
 * Theme toggle — sun/moon icon button in the top bar.
 *
 * Three states cycle on click: light → dark → system. The icon
 * shows current resolved theme, not the setting, so visitors always
 * see what they're getting. Tooltip explains the cycle.
 */
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // next-themes hydration — render a placeholder until the client
  // knows the actual theme, otherwise SSR/CSR mismatch warnings.
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" aria-label="Toggle theme" disabled>
        <Sun className="h-4 w-4" />
      </Button>
    );
  }

  const cycle = () => {
    if (theme === 'light') setTheme('dark');
    else if (theme === 'dark') setTheme('system');
    else setTheme('light');
  };

  const Icon = theme === 'system' ? Monitor : resolvedTheme === 'dark' ? Moon : Sun;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={cycle}
          aria-label={`Switch theme (current: ${theme})`}
          className="text-muted-foreground hover:text-foreground"
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        Theme: {theme} <span className="text-muted-foreground">(click to cycle)</span>
      </TooltipContent>
    </Tooltip>
  );
}

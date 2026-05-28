/**
 * Root layout — fonts, theme provider, global toaster, footer.
 *
 * Typography pairing:
 *   - Geist Sans (body)   — Vercel's product font. Dense, neutral,
 *                            tuned for UI labels and data.
 *   - Geist Mono          — code, hashes, monospace values.
 *   - IBM Plex Serif      — headlines + agent titles. Anchors the
 *                            Beanbag brand identity.
 *
 * `next-themes` provides class-based dark mode (`<html class="dark">`).
 * `suppressHydrationWarning` on <html> is required by next-themes to
 * avoid a flash when the resolved theme differs from the SSR default.
 *
 * Sonner Toaster is mounted globally so any component can call
 * `toast.success(...)` / `toast.error(...)` without re-mounting.
 */
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import type { Metadata } from 'next';
import { IBM_Plex_Serif } from 'next/font/google';
import { Toaster } from 'sonner';
import BeanbagFooter from '@/components/BeanbagFooter';
import { ThemeProvider } from '@/components/ThemeProvider';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

const plexSerif = IBM_Plex_Serif({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Beanbag AI · Agent Marketplace',
  description:
    "Beanbag AI's lineup of autonomous agents — qualify leads, audit invoices, draft proposals, triage churn, and more.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} ${plexSerif.variable}`}
    >
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider delayDuration={120} skipDelayDuration={300}>
            <div className="relative z-10">{children}</div>
            <BeanbagFooter />
            <Toaster
              richColors
              closeButton
              position="bottom-right"
              toastOptions={{
                classNames: {
                  toast:
                    'border border-border bg-popover text-popover-foreground shadow-soft-lg',
                  description: 'text-muted-foreground',
                },
              }}
            />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

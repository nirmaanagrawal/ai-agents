import type { Metadata } from 'next';
import { IBM_Plex_Serif } from 'next/font/google';
import './globals.css';
import BeanbagFooter from '@/components/BeanbagFooter';

/**
 * IBM Plex Serif — Beanbag's headline typeface. Loaded via next/font so
 * it's self-hosted and bundled with the page (no FOUT, no third-party
 * font request at runtime).
 */
const plexSerif = IBM_Plex_Serif({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Beanbag AI · Agent Marketplace',
  description:
    "Beanbag AI's lineup of autonomous agents — qualify leads, audit invoices, and more.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={plexSerif.variable}>
      <body className="min-h-screen bg-cream-100 font-sans text-ink-900 antialiased">
        {children}
        <BeanbagFooter />
      </body>
    </html>
  );
}

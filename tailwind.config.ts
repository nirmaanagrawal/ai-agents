import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

/**
 * Beanbag AI brand tokens + shadcn-style semantic tokens.
 *
 * Two-axis design system:
 *   1. Brand tokens (brand-*, cream-*, ink-*) — fixed coral identity,
 *      legacy components keep working without churn.
 *   2. Semantic tokens (`background`, `foreground`, `primary`, etc.)
 *      driven by CSS variables in globals.css — adapt to light/dark.
 *
 * New components should prefer semantic tokens (bg-background,
 * text-foreground, border-border, etc.) so dark mode just works.
 */
const config: Config = {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        // Brand identity — fixed across themes
        brand: {
          50: '#fdf3f0',
          100: '#fbe5df',
          200: '#f7c8bc',
          300: '#f2a190',
          400: '#ec7a64',
          500: '#ea6347',
          600: '#d44b2f',
          700: '#b03a23',
          800: '#7d2918',
          900: '#52180c',
        },
        cream: {
          50: '#faf8f1',
          100: '#f3f1e7',
          200: '#e8e3cf',
          300: '#d8d0b0',
        },
        ink: {
          900: '#1a1a1a',
          700: '#4a4a4a',
          500: '#666',
          300: '#9ca3af',
        },
        critical: '#dc3545',

        // Semantic — driven by CSS vars, adapt to .dark.
        // `<alpha-value>` placeholder lets opacity modifiers work,
        // e.g. `bg-foreground/80` resolves correctly.
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        success: 'hsl(var(--success) / <alpha-value>)',
        warning: 'hsl(var(--warning) / <alpha-value>)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        // IBM Plex Serif — beanbag.ai identity, used for headlines + agent titles
        serif: ['var(--font-serif)', '"IBM Plex Serif"', 'Georgia', 'serif'],
        // Geist Sans — product UI body type, optimized for dense interface text
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        // Geist Mono — code, hashes, monospace data
        mono: ['var(--font-mono)', 'ui-monospace', 'Menlo', 'Monaco', 'monospace'],
      },
      backgroundImage: {
        // Reusable brand gradient for buttons, accents, hero strips
        'brand-gradient': 'linear-gradient(135deg, #ea6347, #ff6b4a)',
        'brand-gradient-soft':
          'linear-gradient(135deg, rgba(234,99,71,0.10), rgba(234,99,71,0.05))',
      },
      boxShadow: {
        'brand-card': '0 4px 20px rgba(0, 0, 0, 0.06)',
        'brand-cta': '0 4px 15px rgba(234, 99, 71, 0.30)',
        'brand-cta-hover': '0 10px 30px rgba(234, 99, 71, 0.40)',
        // Refined elevation system — used by shadcn-style cards
        'soft': '0 2px 8px -2px rgba(0, 0, 0, 0.04), 0 4px 16px -4px rgba(0, 0, 0, 0.06)',
        'soft-lg':
          '0 4px 16px -4px rgba(0, 0, 0, 0.06), 0 12px 32px -8px rgba(0, 0, 0, 0.08)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          from: { backgroundPosition: '0 0' },
          to: { backgroundPosition: '-200% 0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 0.25s ease-out',
        'fade-up': 'fade-up 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        shimmer: 'shimmer 2s linear infinite',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;

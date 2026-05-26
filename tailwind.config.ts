import type { Config } from 'tailwindcss';

/**
 * Beanbag AI brand tokens — pulled directly from www.beanbag.ai's
 * compiled CSS so the marketplace looks like part of the same product.
 *
 * Primary palette is the coral gradient (`#ea6347` → `#ff6b4a`) with a
 * warm cream background (`#f3f1e7`). Headlines use IBM Plex Serif;
 * body text uses the same system stack as the parent site.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fdf3f0',
          100: '#fbe5df',
          200: '#f7c8bc',
          300: '#f2a190',
          400: '#ec7a64',
          // Anchor — beanbag.ai's hero coral.
          500: '#ea6347',
          600: '#d44b2f',
          700: '#b03a23',
          800: '#7d2918',
          900: '#52180c',
        },
        cream: {
          50: '#faf8f1',
          // Anchor — beanbag.ai's section background.
          100: '#f3f1e7',
          200: '#e8e3cf',
          300: '#d8d0b0',
        },
        ink: {
          // Site headline color.
          900: '#1a1a1a',
          // Site body text color.
          700: '#4a4a4a',
          500: '#666',
          300: '#9ca3af',
        },
        critical: '#dc3545',
      },
      fontFamily: {
        // Pulled from the Google Fonts import on beanbag.ai.
        serif: ['"IBM Plex Serif"', 'Georgia', 'serif'],
        // Same system stack as the parent site's `body` selector.
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'Oxygen',
          'Ubuntu',
          'Cantarell',
          '"Fira Sans"',
          '"Droid Sans"',
          '"Helvetica Neue"',
          'sans-serif',
        ],
      },
      backgroundImage: {
        // Reusable brand gradient for buttons, accents, hero strips.
        'brand-gradient': 'linear-gradient(135deg, #ea6347, #ff6b4a)',
        'brand-gradient-soft':
          'linear-gradient(135deg, rgba(234,99,71,0.10), rgba(234,99,71,0.05))',
      },
      boxShadow: {
        // Matches the soft card shadow used across beanbag.ai.
        'brand-card': '0 4px 20px rgba(0, 0, 0, 0.06)',
        'brand-cta': '0 4px 15px rgba(234, 99, 71, 0.30)',
        'brand-cta-hover': '0 10px 30px rgba(234, 99, 71, 0.40)',
      },
    },
  },
  plugins: [],
};

export default config;

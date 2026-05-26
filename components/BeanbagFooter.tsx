'use client';

/**
 * BeanbagFooter — mirrors the footer on www.beanbag.ai exactly.
 *
 * Uses Tailwind for layout/spacing and inline styles only for the
 * brand-specific dark palette values (#030014, #7C3AED, #22D3EE)
 * that aren't in the Tailwind config. All links point to the
 * main beanbag.ai domain since this is a subdomain app.
 *
 * 'use client' is required because the link rows use onMouseEnter /
 * onMouseLeave handlers for the brand hover color shift. Without the
 * directive Next.js can't prerender the page (event handlers aren't
 * serializable across the server→client boundary).
 */

const currentYear = new Date().getFullYear();

const LINKS = {
  solutions: [
    { label: 'Strategic AI Consulting', href: 'https://www.beanbag.ai/solutions/strategic-consulting' },
    { label: 'GenAI & LLM Engineering',  href: 'https://www.beanbag.ai/solutions/genai-engineering' },
    { label: 'Intelligent Agents',        href: 'https://www.beanbag.ai/solutions/intelligent-agents' },
    { label: 'Data Engineering',          href: 'https://www.beanbag.ai/solutions/data-engineering' },
  ],
  industries: [
    { label: 'Healthcare',          href: 'https://www.beanbag.ai/#industries' },
    { label: 'Banking & FinTech',   href: 'https://www.beanbag.ai/#industries' },
    { label: 'Retail & E-Commerce', href: 'https://www.beanbag.ai/#industries' },
    { label: 'Manufacturing',       href: 'https://www.beanbag.ai/#industries' },
  ],
  resources: [
    { label: 'Blog',          href: 'https://www.beanbag.ai/blog' },
    { label: 'Case Studies',  href: 'https://www.beanbag.ai/case-studies' },
    { label: 'Templates',     href: 'https://www.beanbag.ai/templates' },
    { label: 'Tools',         href: 'https://www.beanbag.ai/tools' },
  ],
  company: [
    { label: 'Privacy Policy',    href: 'https://www.beanbag.ai/privacyPolicy' },
    { label: 'Terms of Service',  href: 'https://www.beanbag.ai/termsofuse' },
  ],
};

/** Inline SVG icons for social links — no external image dependency. */
const LinkedInIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
    <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.37V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.59 0 4.26 2.36 4.26 5.43v6.31ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45Z" />
  </svg>
);

const TwitterIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const YouTubeIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
    <path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.54 3.6 12 3.6 12 3.6s-7.54 0-9.38.45A3.02 3.02 0 0 0 .5 6.19C.06 8.04 0 12 0 12s.06 3.96.5 5.81a3.02 3.02 0 0 0 2.12 2.14C4.46 20.4 12 20.4 12 20.4s7.54 0 9.38-.45a3.02 3.02 0 0 0 2.12-2.14C23.94 15.96 24 12 24 12s-.06-3.96-.5-5.81ZM9.6 15.6V8.4l6.27 3.6-6.27 3.6Z" />
  </svg>
);

const SOCIALS = [
  {
    label: 'LinkedIn',
    href:  'https://linkedin.com/company/beanbag-ai',
    icon:  <LinkedInIcon />,
    hoverColor: '#E2684A',
    hoverShadow: 'rgba(226,104,74,0.4)',
  },
  {
    label: 'X / Twitter',
    href:  'https://x.com/BeanbagAi/',
    icon:  <TwitterIcon />,
    hoverColor: '#7C3AED',
    hoverShadow: 'rgba(124,58,237,0.4)',
  },
  {
    label: 'YouTube',
    href:  'https://www.youtube.com/channel/UCIJnFHNEHpjPhRGn_jI8gTA',
    icon:  <YouTubeIcon />,
    hoverColor: '#22D3EE',
    hoverShadow: 'rgba(34,211,238,0.4)',
  },
];

/** Column heading */
const ColHead = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-4 text-sm font-bold uppercase tracking-widest text-white">
    {children}
  </p>
);

/** Repeatable link row */
const FooterLink = ({ href, label }: { href: string; label: string }) => (
  <a
    href={href}
    target={href.startsWith('https://www.beanbag.ai') ? '_blank' : undefined}
    rel="noreferrer"
    className="mb-2.5 block text-sm transition-colors duration-200"
    style={{ color: 'rgba(255,255,255,0.6)' }}
    onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.color = '#E2684A')}
    onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.color = 'rgba(255,255,255,0.6)')}
  >
    {label}
  </a>
);

export default function BeanbagFooter() {
  return (
    <footer style={{ backgroundColor: '#030014', color: 'rgba(255,255,255,0.7)', position: 'relative', overflow: 'hidden' }}>
      {/* Gradient top border */}
      <div style={{ height: '2px', background: 'linear-gradient(90deg, #E2684A 0%, #7C3AED 50%, #22D3EE 100%)', boxShadow: '0 0 20px rgba(226,104,74,0.5)' }} />

      {/* Background glows */}
      <div style={{ position: 'absolute', top: 0, left: '10%', width: 300, height: 300, background: 'radial-gradient(circle, rgba(124,58,237,0.08) 0%, transparent 70%)', filter: 'blur(60px)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: 0, right: '10%', width: 300, height: 300, background: 'radial-gradient(circle, rgba(226,104,74,0.08) 0%, transparent 70%)', filter: 'blur(60px)', pointerEvents: 'none' }} />

      <div className="relative z-10 mx-auto max-w-6xl px-6 py-12 md:py-16">
        {/* Main grid */}
        <div className="grid grid-cols-2 gap-8 md:grid-cols-12">

          {/* ── Col 1: Logo + tagline + socials ── */}
          <div className="col-span-2 md:col-span-3">
            <a href="https://www.beanbag.ai" target="_blank" rel="noreferrer" className="mb-4 flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/beanbag-logo.png" alt="Beanbag AI" className="h-8 w-8 object-contain" />
              <span className="text-base font-semibold text-white">Beanbag AI</span>
            </a>
            <p className="mb-5 text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.65)' }}>
              Architecting the Intelligent Enterprise — from strategy to deployment.
            </p>

            {/* Social icons */}
            <div className="flex gap-2">
              {SOCIALS.map(s => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={s.label}
                  className="rounded-lg p-2 transition-all duration-200"
                  style={{ border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.55)' }}
                  onMouseEnter={e => {
                    const el = e.currentTarget as HTMLAnchorElement;
                    el.style.borderColor = s.hoverColor;
                    el.style.boxShadow = `0 0 15px ${s.hoverShadow}`;
                    el.style.color = s.hoverColor;
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLAnchorElement;
                    el.style.borderColor = 'rgba(255,255,255,0.1)';
                    el.style.boxShadow = 'none';
                    el.style.color = 'rgba(255,255,255,0.55)';
                  }}
                >
                  {s.icon}
                </a>
              ))}
            </div>
          </div>

          {/* ── Col 2: Solutions ── */}
          <div className="col-span-1 md:col-span-3 md:col-start-4">
            <ColHead>Solutions</ColHead>
            {LINKS.solutions.map(l => <FooterLink key={l.label} {...l} />)}
          </div>

          {/* ── Col 3: Industries + Resources ── */}
          <div className="col-span-1 md:col-span-2">
            <ColHead>Industries</ColHead>
            {LINKS.industries.map(l => <FooterLink key={l.label} {...l} />)}
            <div className="mt-6">
              <ColHead>Resources</ColHead>
              {LINKS.resources.map(l => <FooterLink key={l.label} {...l} />)}
            </div>
          </div>

          {/* ── Col 4: Contact + Company ── */}
          <div className="col-span-2 md:col-span-3 md:col-start-10">
            <ColHead>Get In Touch</ColHead>
            <div className="mb-2 flex items-center gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 opacity-70"><path d="M2.003 5.884 10 9.882l7.997-3.998A2 2 0 0 0 16 4H4a2 2 0 0 0-1.997 1.884Z" /><path d="m18 8.118-8 4-8-4V14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8.118Z" /></svg>
              team@beanbag.ai
            </div>
            <div className="mb-2 flex items-center gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 opacity-70"><path d="M2 3a1 1 0 0 1 1-1h2.153a1 1 0 0 1 .986.836l.74 4.435a1 1 0 0 1-.54 1.06l-1.548.773a11.037 11.037 0 0 0 6.105 6.105l.774-1.548a1 1 0 0 1 1.059-.54l4.435.74a1 1 0 0 1 .836.986V17a1 1 0 0 1-1 1h-2C7.82 18 2 12.18 2 5V3Z" /></svg>
              +91 998 584 7341
            </div>
            <div className="mb-5 flex items-start gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-4 w-4 shrink-0 opacity-70"><path fillRule="evenodd" d="M9.69 18.933l.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 0 0 .281-.14c.186-.1.4-.27.6-.5C13.592 15.756 17 11.41 17 8A7 7 0 1 0 3 8c0 3.41 3.408 7.756 6.693 10.283a6.64 6.64 0 0 0 .997.65Z" clipRule="evenodd" /><path d="M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /></svg>
              <span>8 The Green, Suite #15213<br />Dover, DE, USA 19901</span>
            </div>

            <ColHead>Company</ColHead>
            {LINKS.company.map(l => <FooterLink key={l.label} {...l} />)}
          </div>
        </div>

        {/* Divider + copyright */}
        <div className="mt-10 border-t pt-6" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <p className="text-center text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
            © {currentYear} Remote Community Private Limited — All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

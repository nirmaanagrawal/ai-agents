/**
 * Lead Qualifier wizard — 8 MCQs that anchor the agent's ICP scoring.
 *
 * Trimmed from an earlier 12-question version. The four cut were:
 *   - buyer_seniority   — redundant with buyer_titles (titles encode it)
 *   - tech_signals      — visitors rarely track these; agent infers them
 *                          from careers pages anyway
 *   - budget_signal     — useful for deal sizing, not for scoring FIT
 *   - sales_cycle       — informational; doesn't change lead grade
 *
 * What's left covers the dimensions that actually drive a HOT / WARM /
 * COLD call: what we sell, who we sell to (industry × size × geo ×
 * title), what pain they have, the anti-ICP, and the buying-now triggers.
 *
 * Option lists stay exhaustive — a visitor who has to type "yes that's
 * basically option 3 + option 7" is one we've already lost. Every
 * multi-select allows an "Other (free text)" fallback so the rare
 * custom answer still flows cleanly into the structured ICP.
 */
import type { Answer, Question, WizardDefinition } from './types';

const QUESTIONS: Question[] = [
  {
    id: 'offering',
    kind: 'multi',
    required: true,
    allowOther: true,
    prompt: '1 / 8 — What does your company sell?',
    helpText: 'Pick all that apply. Add specifics in "Other" if your offering isn\'t listed.',
    options: [
      'B2B SaaS product',
      'Consumer SaaS / mobile app',
      'Professional services (consulting / agency)',
      'Recruiting / staffing / GCC build-out',
      'Custom software development',
      'Marketplace (connects buyers + sellers)',
      'Hardware / IoT product',
      'Platform / infrastructure / API',
      'Education / training / certification',
      'Marketing or growth services',
      'Financial services / fintech',
      'Healthcare service or product',
      'Logistics / supply chain',
    ],
  },
  {
    id: 'industries',
    kind: 'multi',
    required: true,
    allowOther: true,
    prompt: '2 / 8 — Which industries does your dream customer operate in?',
    options: [
      'SaaS / B2B software',
      'Fintech / financial services',
      'Healthtech / digital health',
      'AI / ML / data',
      'E-commerce / D2C',
      'Edtech',
      'Marketplaces / gig platforms',
      'Hardware / IoT / robotics',
      'Climate / energy / sustainability',
      'Cybersecurity',
      'Logistics / supply chain',
      'Real estate / proptech',
      'Media / entertainment',
      'Manufacturing / industrial',
    ],
  },
  {
    id: 'company_size',
    kind: 'multi',
    required: true,
    prompt: '3 / 8 — What size companies fit you best?',
    options: [
      'Pre-seed / seed (1-10 employees)',
      'Series A (11-50)',
      'Series B (51-200)',
      'Series C+ (201-1000)',
      'Late stage / public (1000+)',
      'Bootstrapped under $1M ARR',
      'Bootstrapped $1M-$10M ARR',
      'Bootstrapped $10M+ ARR',
      'Enterprise / Fortune 500',
    ],
  },
  {
    id: 'geography',
    kind: 'multi',
    required: true,
    allowOther: true,
    prompt: '4 / 8 — Which geographies do you actively sell into?',
    options: [
      'North America (US + Canada)',
      'Europe (UK + EU)',
      'United Kingdom only',
      'India',
      'Southeast Asia',
      'Middle East / GCC',
      'Australia / New Zealand',
      'Latin America',
      'Africa',
      'East Asia (Japan, Korea, China)',
      'Global / remote-anywhere',
    ],
  },
  {
    id: 'buyer_titles',
    kind: 'multi',
    required: true,
    allowOther: true,
    prompt: '5 / 8 — Which job titles are your buyers?',
    helpText: 'Pick the 3-5 titles you most commonly sell into.',
    options: [
      'CEO / Founder',
      'CTO / VP Engineering',
      'Head of / Director of Engineering',
      'Engineering Manager',
      'VP Product / Head of Product',
      'Head of Talent Acquisition / Recruiting',
      'Head of People / HR / CHRO',
      'CFO / VP Finance',
      'COO / Head of Operations',
      'CMO / VP Marketing / Head of Growth',
      'VP Sales / CRO / Head of Sales',
      'Head of Customer Success',
      'IT Director / Head of IT',
      'Procurement / Vendor management',
      'Data / Analytics leader',
      'Security / CISO',
    ],
  },
  {
    id: 'pain_points',
    kind: 'multi',
    required: true,
    allowOther: true,
    prompt: '6 / 8 — What pain is your buyer trying to solve?',
    helpText:
      'Pick all that apply. The more pains you check, the broader your reach (but watch for too-broad ICPs).',
    options: [
      'Hiring takes too long / months per role',
      'Hiring quality is inconsistent',
      "Can't scale engineering team fast enough",
      'High employee turnover / retention issues',
      'Manual processes blocking growth',
      'Tech debt slowing product velocity',
      'Customer churn / retention',
      'Compliance or regulatory pressure',
      'Cost reduction mandate',
      'Lack of in-house expertise',
      'Sales cycle too long / pipeline dry',
      'Pricing pressure / margin erosion',
      'Difficulty selling to enterprise',
      'Low qualified-lead volume',
      'Conversion rates dropping',
      'Data quality / reporting fragmented',
      'Onboarding / activation drop-off',
      'Talent shortage in specific skills',
    ],
  },
  {
    id: 'anti_icp',
    kind: 'multi',
    allowOther: true,
    prompt: '7 / 8 — Who do you NOT want as customers?',
    helpText: 'Naming the anti-ICP helps the agent flag bad fits as COLD instead of WARM.',
    options: [
      'Pre-seed companies (too early)',
      'Solo founders without an engineering team',
      'Agencies / consultancies acting as middlemen',
      'Bootstrapped under $1M ARR',
      'Companies in financial distress',
      'Lowest-bidder / cost-only buyers',
      'Heavy customization required',
      'Government / public sector',
      'Highly regulated industries (defense, etc.)',
      "Industries we don't serve",
      "Geographies we don't serve",
      'Pre-revenue companies',
      'Short-term gig / one-off projects',
    ],
  },
  {
    id: 'urgency_signals',
    kind: 'multi',
    allowOther: true,
    prompt: '8 / 8 — What buying triggers tell you a lead is ready RIGHT NOW?',
    options: [
      'Just raised a funding round',
      'Just appointed a new CTO / VP Eng',
      'Posted 5+ engineering jobs recently',
      'Publicly committed to scaling team',
      'Launched a major product feature',
      'Mentioned competitor publicly',
      'Press release about growth / scaling',
      'New office / market expansion announced',
      'Acquired another company recently',
      'Visible IPO / fundraising prep',
      'Compliance deadline approaching',
      'Renewal coming up with current vendor',
    ],
  },
];

function composeIcp(answers: Record<string, Answer>): string {
  const list = (id: string): string[] => {
    const v = answers[id];
    if (Array.isArray(v)) return v.filter(Boolean);
    if (typeof v === 'string' && v.trim()) return [v.trim()];
    return [];
  };
  const renderList = (label: string, items: string[]) =>
    items.length ? [`- ${label}:`, ...items.map((i) => `  • ${i}`)] : [];

  const lines: string[] = ['# IDEAL CUSTOMER PROFILE'];

  const offering = list('offering');
  if (offering.length) {
    lines.push('', '## What we sell');
    offering.forEach((o) => lines.push(`- ${o}`));
  }

  const industries = list('industries');
  const sizes = list('company_size');
  const geos = list('geography');
  if (industries.length || sizes.length || geos.length) {
    lines.push('', '## Firmographic Fit (target buyer companies)');
    lines.push(...renderList('Industries', industries));
    lines.push(...renderList('Company sizes', sizes));
    lines.push(...renderList('Geographies', geos));
  }

  const titles = list('buyer_titles');
  if (titles.length) {
    lines.push('', '## Decision-Makers');
    lines.push(...renderList('Job titles to look for', titles));
  }

  const pains = list('pain_points');
  if (pains.length) {
    lines.push('', '## Pain Points the Buyer is Trying to Solve');
    pains.forEach((p) => lines.push(`- ${p}`));
  }

  const triggers = list('urgency_signals');
  if (triggers.length) {
    lines.push('', '## Buying-Now Triggers (these alone can push a lead to HOT)');
    triggers.forEach((t) => lines.push(`- ${t}`));
  }

  const anti = list('anti_icp');
  if (anti.length) {
    lines.push('', '## Anti-ICP (mark these as COLD / waste of time)');
    anti.forEach((a) => lines.push(`- ${a}`));
  }

  return lines.join('\n');
}

export const leadQualifierWizard: WizardDefinition = {
  title: 'ICP setup',
  questions: QUESTIONS,
  composeIcp,
};

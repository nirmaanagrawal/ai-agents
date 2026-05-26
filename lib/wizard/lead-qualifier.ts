/**
 * Lead Qualifier wizard — 12 MCQ questions that compose a structured
 * ICP for the Lead Qualifier agent.
 *
 * Option lists are intentionally exhaustive. A visitor who has to type
 * "yes that's basically option 3 + option 7" is one we've already lost;
 * we'd rather offer 14 options than 6. Every multi-select allows an
 * "Other (free text)" fallback so the rare custom answer still flows
 * cleanly into the structured ICP.
 */
import type { Answer, Question, WizardDefinition } from './types';

const QUESTIONS: Question[] = [
  {
    id: 'offering',
    kind: 'multi',
    required: true,
    allowOther: true,
    prompt: '1 / 12 — What does your company sell?',
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
    prompt: '2 / 12 — Which industries does your dream customer operate in?',
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
    prompt: '3 / 12 — What size companies fit you best?',
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
    prompt: '4 / 12 — Which geographies do you actively sell into?',
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
    prompt: '5 / 12 — Which job titles are your buyers?',
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
    id: 'buyer_seniority',
    kind: 'single',
    required: true,
    prompt: '6 / 12 — How senior is the actual decision-maker on a typical deal?',
    options: [
      'C-level / Founder',
      'VP / Head of (functional leader)',
      'Director / Senior Manager',
      'Manager / IC who escalates upward',
      'Mixed — depends on deal size',
    ],
  },
  {
    id: 'pain_points',
    kind: 'multi',
    required: true,
    allowOther: true,
    prompt: '7 / 12 — What pain is your buyer trying to solve?',
    helpText: 'Pick all that apply. The more pains you check, the broader your reach (but watch for too-broad ICPs).',
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
    id: 'tech_signals',
    kind: 'multi',
    allowOther: true,
    prompt: '8 / 12 — Operational / tech-stack signals that suggest a great fit?',
    options: [
      'Uses AWS / GCP / Azure',
      'Multi-cloud setup',
      'Active engineering blog / GitHub presence',
      'Has a public API',
      'Uses Kubernetes / containers heavily',
      'Hiring on careers page right now',
      'Recent funding round',
      'Newly-appointed CTO / VP Eng',
      'Recent product launch',
      'Modern data stack (Snowflake, dbt, etc.)',
      'Engineering team > 50 people',
      'Has dedicated DevOps / platform team',
    ],
  },
  {
    id: 'budget_signal',
    kind: 'single',
    required: true,
    prompt: '9 / 12 — Average deal size for a closed-won customer?',
    options: [
      'Under $5K (self-serve)',
      '$5K — $25K (SMB)',
      '$25K — $100K (mid-market)',
      '$100K — $500K (enterprise)',
      '$500K+ (strategic)',
      'Highly variable',
    ],
  },
  {
    id: 'sales_cycle',
    kind: 'single',
    required: true,
    prompt: '10 / 12 — Typical sales-cycle length?',
    options: ['< 2 weeks', '2-6 weeks', '1-3 months', '3-6 months', '6-12 months', '12+ months'],
  },
  {
    id: 'anti_icp',
    kind: 'multi',
    allowOther: true,
    prompt: '11 / 12 — Who do you NOT want as customers? Mark all that apply.',
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
    prompt: '12 / 12 — What buying triggers tell you a lead is ready RIGHT NOW?',
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
  const one = (id: string): string => {
    const v = answers[id];
    if (typeof v === 'string') return v.trim();
    if (Array.isArray(v) && v.length === 1) return v[0];
    return '';
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
  const seniority = one('buyer_seniority');
  if (titles.length || seniority) {
    lines.push('', '## Decision-Makers');
    lines.push(...renderList('Job titles to look for', titles));
    if (seniority) lines.push(`- Typical seniority: ${seniority}`);
  }

  const pains = list('pain_points');
  if (pains.length) {
    lines.push('', '## Pain Points the Buyer is Trying to Solve');
    pains.forEach((p) => lines.push(`- ${p}`));
  }

  const techs = list('tech_signals');
  if (techs.length) {
    lines.push('', '## Positive Signals (boost the score when present)');
    techs.forEach((t) => lines.push(`- ${t}`));
  }

  const triggers = list('urgency_signals');
  if (triggers.length) {
    lines.push('', '## Buying-Now Triggers (these alone can push a lead to HOT)');
    triggers.forEach((t) => lines.push(`- ${t}`));
  }

  const budget = one('budget_signal');
  const cycle = one('sales_cycle');
  if (budget || cycle) {
    lines.push('', '## Economics');
    if (budget) lines.push(`- Average deal size: ${budget}`);
    if (cycle) lines.push(`- Typical sales cycle: ${cycle}`);
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

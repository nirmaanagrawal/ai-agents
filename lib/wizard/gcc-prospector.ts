/**
 * GCC Prospector wizard — 8 MCQs that anchor the discovery agent's
 * search strategy.
 *
 * Trim history: started at 12 questions, cut down to 8. The cut
 * questions (funding_stage, tech_stack, extra_context, output_count)
 * either duplicated signal already captured by other questions or
 * weren't strong enough discovery levers to be worth the friction.
 *
 * Critical positioning question: "popularity"
 *   The visitor specifically wants under-the-radar GCCs — the kind
 *   that don't show up in TechCrunch GCC round-ups. We surface this
 *   as a single-choice question and the agent's system prompt uses
 *   the answer to bias its search queries away from press-driven
 *   discovery patterns.
 */
import type { Answer, Question, WizardDefinition } from './types';

const QUESTIONS: Question[] = [
  {
    id: 'hq_country',
    kind: 'multi',
    required: true,
    allowOther: true,
    prompt: '1 / 8 — Where are the target companies headquartered?',
    helpText: 'GCC = company HQ\'d outside India with engineering team(s) in India.',
    options: [
      'United States',
      'United Kingdom',
      'Germany',
      'Netherlands',
      'France',
      'Israel',
      'Australia',
      'Canada',
      'Singapore',
      'Sweden / Nordics',
      'Switzerland',
    ],
  },
  {
    id: 'popularity',
    kind: 'single',
    required: true,
    prompt: '2 / 8 — How well-known should the target companies be?',
    helpText:
      'Under-the-radar GCCs are usually a better outreach surface — already-popular ones are saturated with vendors.',
    options: [
      'Under-the-radar (NOT covered in mainstream press)',
      'Mid-tier (some coverage, not household names)',
      'Established / well-known GCCs',
      'Mix — surface them all',
    ],
  },
  {
    id: 'industries',
    kind: 'multi',
    required: true,
    allowOther: true,
    prompt: '3 / 8 — Which industries are you targeting?',
    options: [
      'B2B SaaS / horizontal software',
      'Fintech / payments',
      'AI / ML / data infrastructure',
      'Cybersecurity',
      'Cloud infrastructure / DevOps',
      'Healthtech / digital health',
      'E-commerce / marketplaces',
      'Edtech',
      'Logistics / supply chain',
      'Climate / energy / sustainability',
      'Crypto / web3',
      'Adtech / marketing',
      'Hardware / IoT / robotics',
      'Media / streaming',
      'Real estate / proptech',
    ],
  },
  {
    id: 'india_cities',
    kind: 'multi',
    required: true,
    prompt: '4 / 8 — Which Indian cities should the GCC operate in?',
    helpText: 'Most GCCs are in Bangalore / Hyderabad / Pune. Pick the ones you can serve.',
    options: [
      'Bangalore / Bengaluru',
      'Hyderabad',
      'Pune',
      'Chennai',
      'Gurgaon / Gurugram',
      'Noida',
      'Mumbai',
      'Delhi NCR',
      'Kolkata',
      'Ahmedabad',
      'Anywhere in India',
    ],
  },
  {
    id: 'india_team_size',
    kind: 'single',
    required: true,
    prompt: '5 / 8 — Target India team size (engineering headcount)?',
    options: [
      'Newly forming (1-20) — emerging GCC',
      'Small (21-75) — early-stage GCC',
      'Mid-sized (76-250) — growing GCC',
      'Large (251-1000) — mature GCC',
      'Mega (1000+) — established global captive',
      'Any size',
    ],
  },
  {
    id: 'engineering_roles',
    kind: 'multi',
    required: true,
    prompt: '6 / 8 — What engineering roles are you targeting?',
    helpText: 'Drives the careers-page filtering. Also lets the agent infer the tech stack.',
    options: [
      'Software Engineers (full-stack / backend / frontend)',
      'Senior / Staff / Principal Engineers',
      'Engineering Managers / Tech Leads',
      'ML / AI Engineers',
      'Data Engineers / Scientists',
      'DevOps / SRE / Platform Engineers',
      'Mobile Engineers (iOS / Android)',
      'Security Engineers',
      'QA / SDET',
      'Solutions / Field Engineers',
      'Engineering Directors / VPs (leadership hires)',
    ],
  },
  {
    id: 'urgency_signals',
    kind: 'multi',
    required: true,
    prompt: '7 / 8 — Which signals say "this GCC is hiring NOW"?',
    helpText:
      'These weight the score heavily — a company with 15+ India eng roles posted in the last 30 days is a HOT prospect.',
    options: [
      '10+ open engineering roles in India (any time)',
      '5+ roles posted in last 30 days',
      'Senior / leadership role in India open',
      'Recent India office expansion announced',
      'Newly appointed India site lead / GM',
      'Recent funding round (parent company)',
      'M&A activity involving India',
      'India job listings prominent on global careers page',
    ],
  },
  {
    id: 'anti_icp',
    kind: 'multi',
    required: true,
    allowOther: true,
    prompt: '8 / 8 — Which companies do you want to EXCLUDE from results?',
    helpText: 'Common exclusions: the obvious mega-GCCs, BPOs/IT-services, anyone you already work with.',
    options: [
      'Mega-GCCs you already know (Google, Microsoft, Amazon, Meta, Apple)',
      'Indian IT-services / BPO firms (TCS, Infosys, Wipro, etc.)',
      'Consultancies / agencies (no in-house product engineering)',
      'Pre-seed / pre-revenue companies',
      'Defense / military',
      'Crypto / web3 (if you don\'t serve them)',
      'Gambling / adult content',
      'Companies in financial distress / layoffs',
      'Already-customers of yours',
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
  const bullets = (items: string[]) => items.map((i) => `- ${i}`);

  const lines: string[] = ['# GCC PROSPECT PROFILE'];

  const hq = list('hq_country');
  if (hq.length) {
    lines.push('', '## Target HQ Countries');
    lines.push(...bullets(hq));
  }

  const pop = one('popularity');
  if (pop) {
    lines.push('', '## Popularity Bias');
    lines.push(`- ${pop}`);
    if (pop.toLowerCase().includes('under-the-radar')) {
      lines.push(
        '- IMPORTANT: prioritize companies that do NOT appear in mainstream press round-ups of GCCs. Bias web searches toward careers pages, LinkedIn engineering posts, and individual hiring announcements rather than "top GCCs in India" lists.',
      );
    }
  }

  const industries = list('industries');
  if (industries.length) {
    lines.push('', '## Industries to Target');
    lines.push(...bullets(industries));
  }

  const cities = list('india_cities');
  const teamSize = one('india_team_size');
  if (cities.length || teamSize) {
    lines.push('', '## India Presence');
    if (cities.length) {
      lines.push('- Target cities:');
      cities.forEach((c) => lines.push(`  • ${c}`));
    }
    if (teamSize) lines.push(`- Target India team size: ${teamSize}`);
  }

  const roles = list('engineering_roles');
  if (roles.length) {
    lines.push('', '## Engineering Roles to Look For');
    roles.forEach((r) => lines.push(`- ${r}`));
  }

  const urgency = list('urgency_signals');
  if (urgency.length) {
    lines.push(
      '',
      '## Hiring-Intent Signals (each one boosts the prospect\'s grade; multiple → HOT)',
    );
    urgency.forEach((u) => lines.push(`- ${u}`));
  }

  const anti = list('anti_icp');
  if (anti.length) {
    lines.push('', '## Exclude These Companies');
    anti.forEach((a) => lines.push(`- ${a}`));
  }

  return lines.join('\n');
}

export const gccProspectorWizard: WizardDefinition = {
  title: 'GCC profile setup',
  questions: QUESTIONS,
  composeIcp,
};

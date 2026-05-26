/**
 * Sales Proposal wizard — 8 MCQs that anchor the proposal's shape
 * (format, tone, length, pricing model, discount latitude, sections,
 * differentiation angles, win-probability bar).
 *
 * Without these, the agent has to guess at register, length, and
 * pricing approach — wildly different across mid-market deals,
 * enterprise SOWs, and PLG-style upsells. Eight quick clicks lock
 * in the shape.
 */
import type { Answer, Question, WizardDefinition } from './types';

const QUESTIONS: Question[] = [
  {
    id: 'proposal_type',
    kind: 'single',
    required: true,
    prompt: '1 / 8 — What kind of proposal are you sending?',
    options: [
      'Formal SOW / Statement of Work',
      'Sales proposal (mid-market deal)',
      'Quote / pricing-only document',
      'Pilot / POC agreement',
      'Multi-year enterprise master agreement',
      'Renewal / expansion proposal',
    ],
  },
  {
    id: 'audience_seniority',
    kind: 'single',
    required: true,
    prompt: '2 / 8 — Who will read this proposal?',
    helpText: 'Drives the register — execs want headlines + ROI, ICs want detail.',
    options: [
      'C-level / Founder',
      'VP / Head of (functional leader)',
      'Director / Senior Manager',
      'IC / Manager who will champion internally',
      'Procurement / Vendor management',
      'Mixed — both decision-maker and procurement',
    ],
  },
  {
    id: 'pricing_model',
    kind: 'single',
    required: true,
    prompt: '3 / 8 — How are you pricing this?',
    options: [
      'Fixed price (scope-locked)',
      'Time & materials (hourly / daily rate)',
      'Subscription (monthly / annual)',
      'Outcome-based (paid on results)',
      'Hybrid (fixed setup + ongoing fee)',
      'Tiered (good / better / best)',
    ],
  },
  {
    id: 'discount_latitude',
    kind: 'single',
    required: true,
    prompt: '4 / 8 — What discount can the agent offer if needed?',
    helpText:
      'Strict cap. The agent will note any concession used in the reasoning so you can sanity-check.',
    options: [
      'None — list price firm',
      'Up to 5%',
      'Up to 10%',
      'Up to 15%',
      'Up to 20%',
      'Open — flag for human approval',
    ],
  },
  {
    id: 'tone',
    kind: 'single',
    required: true,
    prompt: '5 / 8 — Tone of voice?',
    options: [
      'Formal / corporate',
      'Conversational / warm',
      'Consultative / advisory',
      'Bold / pointed (challenger-sale)',
      'Technical / engineering-led',
    ],
  },
  {
    id: 'length',
    kind: 'single',
    required: true,
    prompt: '6 / 8 — How long should it be?',
    options: [
      '1-page summary',
      '2-3 pages (tight)',
      '4-6 pages (standard)',
      '7-12 pages (detailed)',
      '12+ pages (enterprise / RFP-style)',
    ],
  },
  {
    id: 'sections',
    kind: 'multi',
    required: true,
    prompt: '7 / 8 — Which sections MUST the proposal include?',
    helpText: 'Pick all that apply. The agent will skip sections you don\'t check.',
    options: [
      'Executive summary',
      'Understanding of the problem',
      'Proposed scope of work',
      'Pricing table',
      'Timeline / milestones',
      'Team / who will deliver',
      'Case studies / similar wins',
      'Assumptions',
      'Risks + mitigations',
      'SLAs / guarantees',
      'Why us vs alternatives',
      'Terms + acceptance / next steps',
    ],
  },
  {
    id: 'differentiation',
    kind: 'multi',
    required: true,
    prompt: '8 / 8 — Which angles should the proposal lean on?',
    helpText: 'These are your wedge — the agent will weave them through the proposal narrative.',
    options: [
      'Speed of delivery (faster than competitors)',
      'Quality / craft / track record',
      'Domain expertise in this industry',
      'Price competitiveness',
      'Senior-only team (no juniors)',
      'Methodology / repeatable process',
      'Geographic advantage (e.g., India delivery cost)',
      'White-glove / dedicated CSM',
      'Tech differentiator (proprietary tool / IP)',
      'Risk-free trial / money-back',
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

  const lines: string[] = ['# PROPOSAL SHAPE'];

  const type = one('proposal_type');
  if (type) {
    lines.push('', '## Proposal Type');
    lines.push(`- ${type}`);
  }

  const aud = one('audience_seniority');
  if (aud) {
    lines.push('', '## Audience');
    lines.push(`- ${aud}`);
    lines.push(
      '- Tune the register accordingly: execs want headline numbers + ROI; ICs want scope and timeline detail; procurement wants clean pricing + terms.',
    );
  }

  const pricing = one('pricing_model');
  if (pricing) {
    lines.push('', '## Pricing Model');
    lines.push(`- ${pricing}`);
  }

  const disc = one('discount_latitude');
  if (disc) {
    lines.push('', '## Discount Latitude');
    lines.push(`- ${disc}`);
    lines.push(
      '- Stay within this cap. If you apply a discount, name the reason in the reasoning field so the rep can sanity-check.',
    );
  }

  const tone = one('tone');
  if (tone) {
    lines.push('', '## Tone of Voice');
    lines.push(`- ${tone}`);
  }

  const len = one('length');
  if (len) {
    lines.push('', '## Length Target');
    lines.push(`- ${len}`);
  }

  const sections = list('sections');
  if (sections.length) {
    lines.push('', '## Required Sections (include EXACTLY these — skip any not listed)');
    lines.push(...bullets(sections));
  }

  const diff = list('differentiation');
  if (diff.length) {
    lines.push('', '## Differentiation Angles (weave these through the narrative)');
    lines.push(...bullets(diff));
  }

  return lines.join('\n');
}

export const salesProposalWizard: WizardDefinition = {
  title: 'Proposal shape setup',
  questions: QUESTIONS,
  composeIcp,
};

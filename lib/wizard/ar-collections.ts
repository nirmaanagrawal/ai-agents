/**
 * AR Collections wizard — 8 MCQs that anchor the dunning playbook
 * (business model, aging buckets, tone progression, available
 * collection actions, write-off threshold, escalation policy,
 * strategic-account floor, payment-terms standard).
 *
 * Without these, the agent has to guess at when to nudge vs nuke,
 * what actions are even possible (a SaaS can pause access; an
 * agency usually can't), and which customers get white-glove
 * treatment regardless of age. Eight clicks lock the playbook.
 */
import type { Answer, Question, WizardDefinition } from './types';

const QUESTIONS: Question[] = [
  {
    id: 'business_model',
    kind: 'single',
    required: true,
    prompt: '1 / 8 — What kind of business are you collecting for?',
    helpText:
      'Drives what actions the agent can recommend. A SaaS can pause access; an agency usually negotiates instead.',
    options: [
      'SaaS / subscription (can pause access)',
      'Services / agency (project-based)',
      'E-commerce / B2B wholesale',
      'Marketplace / platform (split-payouts)',
      'Mixed / other',
    ],
  },
  {
    id: 'aging_buckets',
    kind: 'single',
    required: true,
    prompt: '2 / 8 — Which aging buckets do you use?',
    helpText: 'The agent assigns each invoice to a bucket and adapts severity from there.',
    options: [
      'Standard: Current / 1-30 / 31-60 / 61-90 / 90+',
      'Tight: Current / 1-15 / 16-30 / 31-60 / 60+',
      'Loose: Current / 1-45 / 46-90 / 91-120 / 120+',
      'Net-15 ops: Current / 1-7 / 8-21 / 22-45 / 45+',
    ],
  },
  {
    id: 'tone_progression',
    kind: 'single',
    required: true,
    prompt: '3 / 8 — How should tone escalate as invoices age?',
    helpText: 'The agent picks tone per invoice based on this curve.',
    options: [
      'Gentle throughout — relationship-first',
      'Gentle → firm → final notice (standard)',
      'Firm from day 1 — strict payment culture',
      'Adaptive — gentle for strategic, firm for everyone else',
    ],
  },
  {
    id: 'available_actions',
    kind: 'multi',
    required: true,
    prompt: '4 / 8 — Which collection actions can you actually take?',
    helpText:
      'Pick all that apply. The agent will only recommend actions on this list — never invents one you can\'t execute.',
    options: [
      'Send dunning email',
      'Retry auto-charge / re-run payment',
      'Phone call from AR clerk',
      'Escalate to AE / CSM',
      'Escalate to Finance lead / CFO',
      'Pause service / suspend access',
      'Apply late-payment fee',
      'Offer payment plan',
      'Send to collections agency',
      'Write off',
    ],
  },
  {
    id: 'write_off_threshold',
    kind: 'single',
    required: true,
    prompt: '5 / 8 — When does the agent flag an invoice as write-off-risk?',
    helpText: 'Below this bar the agent recommends giving up rather than spending more effort.',
    options: [
      'Never — fight for every dollar',
      '120+ days past due AND amount < $500',
      '180+ days past due (any amount)',
      '120+ days past due AND no customer response in 60+ days',
      'Custom — flag for human judgment',
    ],
  },
  {
    id: 'escalation_owner',
    kind: 'single',
    required: true,
    prompt: '6 / 8 — Who owns the escalation for critical AR?',
    options: [
      'AR clerk handles everything until 90+',
      'AE / CSM owns customer relationship — escalate to them first',
      'Finance lead / Controller handles 60+',
      'CFO / Founder handles 90+',
      'Shared ownership — agent suggests by amount',
    ],
  },
  {
    id: 'strategic_floor',
    kind: 'single',
    required: true,
    prompt: '7 / 8 — How should the agent treat your largest customers?',
    helpText:
      'Strategic accounts often need a CSM nudge, not a dunning email — even when overdue.',
    options: [
      'Top 10% by ARR — CSM ping first, no auto-dunning',
      'Top 20% by ARR — soft touch only',
      'Treat everyone the same — overdue is overdue',
      'Custom segment — pause dunning if tier=Strategic in the data',
    ],
  },
  {
    id: 'payment_terms',
    kind: 'single',
    required: true,
    prompt: '8 / 8 — What\'s your standard payment terms?',
    helpText: 'Used to detect deviations (an invoice marked Net-60 in a Net-30 shop is unusual).',
    options: [
      'Net 7 (immediate)',
      'Net 15',
      'Net 30 (standard B2B)',
      'Net 45',
      'Net 60 (enterprise)',
      'Varies by contract',
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

  const lines: string[] = ['# AR COLLECTIONS PLAYBOOK'];

  const model = one('business_model');
  if (model) {
    lines.push('', '## Business Model');
    lines.push(`- ${model}`);
  }

  const buckets = one('aging_buckets');
  if (buckets) {
    lines.push('', '## Aging Buckets');
    lines.push(`- ${buckets}`);
    lines.push('- Assign every invoice to one of these buckets based on days past due.');
  }

  const tone = one('tone_progression');
  if (tone) {
    lines.push('', '## Tone Progression');
    lines.push(`- ${tone}`);
  }

  const actions = list('available_actions');
  if (actions.length) {
    lines.push('', '## Available Collection Actions (recommend ONLY from this list)');
    lines.push(...bullets(actions));
  }

  const writeOff = one('write_off_threshold');
  if (writeOff) {
    lines.push('', '## Write-Off Threshold');
    lines.push(`- ${writeOff}`);
  }

  const escalation = one('escalation_owner');
  if (escalation) {
    lines.push('', '## Escalation Policy');
    lines.push(`- ${escalation}`);
  }

  const strategic = one('strategic_floor');
  if (strategic) {
    lines.push('', '## Strategic-Account Floor');
    lines.push(`- ${strategic}`);
    lines.push(
      '- For strategic customers, prefer a relationship-led play (CSM/AE ping) over an automated dunning email — even when overdue.',
    );
  }

  const terms = one('payment_terms');
  if (terms) {
    lines.push('', '## Standard Payment Terms');
    lines.push(`- ${terms}`);
    lines.push(
      '- If an invoice deviates from these terms, call it out in the reasoning (it may be a special contract — or a data error).',
    );
  }

  return lines.join('\n');
}

export const arCollectionsWizard: WizardDefinition = {
  title: 'Collections playbook setup',
  questions: QUESTIONS,
  composeIcp,
};

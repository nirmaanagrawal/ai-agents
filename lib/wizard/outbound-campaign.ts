/**
 * Outbound Campaign wizard — 8 MCQs that anchor the sequence's shape
 * (goal, channel mix, length, tone arc, cadence, angles, opt-out,
 * must-avoid claims).
 *
 * Without these, the agent has to guess at register, length, and
 * which "hook style" to lead with — wildly different across founder-
 * led PLG, enterprise field sales, and recruiter outbound. Eight
 * clicks lock the playbook so every persona's sequence is consistent
 * with the rep's actual brand voice + compliance constraints.
 */
import type { Answer, Question, WizardDefinition } from './types';

const QUESTIONS: Question[] = [
  {
    id: 'campaign_goal',
    kind: 'single',
    required: true,
    prompt: '1 / 8 — What\'s the goal of this campaign?',
    helpText: 'Drives the CTA the agent picks per step.',
    options: [
      'Book a demo / discovery call',
      'Book a quick intro chat (no pitch)',
      'Drive trial / freemium signup',
      'Drive event registration (webinar / dinner)',
      'Re-engage cold pipeline',
      'Nurture awareness (no immediate ask)',
    ],
  },
  {
    id: 'channel_mix',
    kind: 'single',
    required: true,
    prompt: '2 / 8 — Which channels will this run on?',
    helpText: 'The sequence will mix steps across these channels.',
    options: [
      'Email only',
      'LinkedIn only (InMail / DM)',
      'Email + LinkedIn (mix)',
      'Email + LinkedIn + phone (full multi-touch)',
      'Cold call + follow-up email (call-led)',
    ],
  },
  {
    id: 'sequence_length',
    kind: 'single',
    required: true,
    prompt: '3 / 8 — How many touches in a full sequence?',
    options: [
      '3 touches (tight)',
      '4-5 touches (standard)',
      '6-7 touches (persistent)',
      '8-10 touches (long-running drip)',
    ],
  },
  {
    id: 'tone_arc',
    kind: 'single',
    required: true,
    prompt: '4 / 8 — How should tone evolve through the sequence?',
    options: [
      'Warm throughout — relationship-first',
      'Curious → direct → breakup (standard arc)',
      'Pattern-interrupt — start unconventional, stay punchy',
      'Consultative — lead with insight, light asks',
      'Bold / challenger — provoke, then propose',
    ],
  },
  {
    id: 'cadence',
    kind: 'single',
    required: true,
    prompt: '5 / 8 — How often should touches land?',
    helpText: 'The agent will set dayOffset per step from this.',
    options: [
      'Daily (5 days, tight burst)',
      'Every 2-3 days (standard)',
      'Weekly (slow drip)',
      'Mixed — close together at start, spaced after',
    ],
  },
  {
    id: 'must_include_angles',
    kind: 'multi',
    required: true,
    prompt: '6 / 8 — Which angles MUST the sequence work in?',
    helpText: 'Pick all that apply. Each persona\'s sequence will lean on these.',
    options: [
      'Specific pain point (lead with their problem)',
      'Concrete outcome / metric (e.g., "cut hiring time 40%")',
      'Customer social proof / case study',
      'Industry-specific insight or trend',
      'Personal observation about THIS company (signal)',
      'Time-bound urgency (deadline, season, event)',
      'Provocative question / pattern-interrupt opener',
      'Light competitive framing',
    ],
  },
  {
    id: 'opt_out_behavior',
    kind: 'single',
    required: true,
    prompt: '7 / 8 — How should opt-out / unsubscribe work?',
    helpText: 'Required for CAN-SPAM / GDPR compliance in most regions.',
    options: [
      'Link in footer of every email (compliant default)',
      'Soft opt-out in first email only ("not a fit? just reply")',
      'No automated opt-out — reply-to-pause only',
      'Add to body of last step only',
    ],
  },
  {
    id: 'must_avoid',
    kind: 'multi',
    required: true,
    prompt: '8 / 8 — What must the sequence NEVER do?',
    helpText: 'Strict guardrails. The agent will validate every step against these.',
    options: [
      'Generic openers ("Hope you\'re well", "Quick question")',
      'Overpromise (no claims we can\'t back up)',
      'Name-personalization-only ("Hi {{first_name}}" with no context)',
      'Mention discounts or pricing in early steps',
      'Name competitors directly',
      'Use AI-detection trigger phrases ("I noticed your company is")',
      'Cold call without prior email touch',
      'More than 1 link per email',
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

  const lines: string[] = ['# CAMPAIGN PLAYBOOK'];

  const goal = one('campaign_goal');
  if (goal) {
    lines.push('', '## Campaign Goal');
    lines.push(`- ${goal}`);
    lines.push('- Every step\'s CTA must ladder toward this goal.');
  }

  const channel = one('channel_mix');
  if (channel) {
    lines.push('', '## Channel Mix');
    lines.push(`- ${channel}`);
    lines.push(
      '- Tag each step with the channel it runs on. Match the body length + tone to the channel (LinkedIn = shorter, phone = scripted bullet points, email = full).',
    );
  }

  const length = one('sequence_length');
  if (length) {
    lines.push('', '## Sequence Length');
    lines.push(`- ${length}`);
  }

  const tone = one('tone_arc');
  if (tone) {
    lines.push('', '## Tone Arc Through the Sequence');
    lines.push(`- ${tone}`);
  }

  const cadence = one('cadence');
  if (cadence) {
    lines.push('', '## Cadence');
    lines.push(`- ${cadence}`);
    lines.push(
      '- Set dayOffset per step from this cadence (step 1 = day 0, then space subsequent steps accordingly).',
    );
  }

  const angles = list('must_include_angles');
  if (angles.length) {
    lines.push('', '## Required Angles (weave these through every persona\'s sequence)');
    lines.push(...bullets(angles));
  }

  const optOut = one('opt_out_behavior');
  if (optOut) {
    lines.push('', '## Opt-Out / Compliance');
    lines.push(`- ${optOut}`);
  }

  const avoid = list('must_avoid');
  if (avoid.length) {
    lines.push('', '## Hard Don\'ts (validate every step against this list)');
    lines.push(...bullets(avoid));
  }

  return lines.join('\n');
}

export const outboundCampaignWizard: WizardDefinition = {
  title: 'Campaign playbook setup',
  questions: QUESTIONS,
  composeIcp,
};

/**
 * Churn Risk wizard — 8 MCQs that anchor the agent's risk-scoring
 * rubric. Without these, every account looks the same — the model
 * has no idea which signal matters most to THIS visitor's CS motion.
 *
 * Questions tuned to capture: business model, account tiering,
 * which signals matter, what "healthy" looks like, time window,
 * save plays available, escalation triggers, and report sections.
 */
import type { Answer, Question, WizardDefinition } from './types';

const QUESTIONS: Question[] = [
  {
    id: 'business_model',
    kind: 'single',
    required: true,
    prompt: '1 / 8 — What kind of business are you running?',
    helpText: 'Sets context for what churn signals to weight heaviest.',
    options: [
      'B2B SaaS (annual contracts)',
      'B2B SaaS (monthly self-serve)',
      'Product-led growth (PLG) with paid tiers',
      'Marketplace (two-sided)',
      'Enterprise software with managed services',
      'Subscription consumer product',
      'Services / consulting retainer',
    ],
  },
  {
    id: 'account_tiers',
    kind: 'multi',
    required: true,
    prompt: '2 / 8 — How do you tier accounts?',
    helpText:
      'Drives prioritization — strategic accounts get tighter scrutiny and bigger save plays.',
    options: [
      'Strategic / Enterprise ($100K+ ARR)',
      'Mid-market ($25K–$100K ARR)',
      'SMB ($5K–$25K ARR)',
      'Self-serve / Long-tail (under $5K)',
      'By contract length (annual vs monthly)',
      'By industry vertical',
      'By logo size / brand value',
    ],
  },
  {
    id: 'critical_signals',
    kind: 'multi',
    required: true,
    allowOther: true,
    prompt: '3 / 8 — Which signals matter MOST in your data?',
    helpText:
      'Pick what you actually track. The agent will weight these heavily; ignore signals you don\'t.',
    options: [
      'Login frequency / DAU / WAU',
      'Feature adoption depth',
      'Seat utilization (% of paid seats active)',
      'Support ticket volume + sentiment',
      'NPS / CSAT scores',
      'Payment health (late / failed payments)',
      'Executive sponsor changes',
      'Contract renewal proximity',
      'API call volume',
      'Integration health (broken / disconnected)',
      'Time since last QBR / business review',
      'Stakeholder turnover at customer org',
    ],
  },
  {
    id: 'engagement_baseline',
    kind: 'single',
    required: true,
    prompt: '4 / 8 — What does a HEALTHY account look like in your product?',
    options: [
      'Daily active users in 80%+ of paid seats',
      'Weekly active users in 60%+ of paid seats',
      'Monthly active users in 50%+ of paid seats',
      'Quarterly review attendance + NPS ≥ 8',
      'Logged in within the last 14 days',
      'Mixed — depends on tier',
    ],
  },
  {
    id: 'risk_window',
    kind: 'single',
    required: true,
    prompt: '5 / 8 — What time window defines "concerning" inactivity?',
    options: [
      'No activity in 14 days = warning',
      'No activity in 30 days = warning',
      'No activity in 60 days = warning',
      '50% drop in usage week-over-week = warning',
      'Trend-based — agent should detect from the data',
    ],
  },
  {
    id: 'save_plays',
    kind: 'multi',
    required: true,
    prompt: '6 / 8 — What save plays are available to your CS team?',
    helpText:
      'The agent will recommend ONE play per at-risk account from this list. No invented plays.',
    options: [
      'CSM check-in email',
      'CSM scheduled call (30 min)',
      'Quarterly business review (QBR)',
      'Executive sponsor outreach',
      'Discount / pricing concession',
      'Free training / enablement session',
      'Account team change (different CSM)',
      'Product feature unlock / pilot',
      'Renewal renegotiation (longer term, lower rate)',
      'Polite goodbye (accept the churn, save the time)',
    ],
  },
  {
    id: 'escalation_triggers',
    kind: 'multi',
    required: true,
    prompt: '7 / 8 — Which signals require IMMEDIATE escalation?',
    helpText:
      'These auto-mark an account as CHURN RISK regardless of overall score.',
    options: [
      'Executive sponsor left the customer org',
      'Late payment > 30 days',
      'Open critical-severity support ticket > 7 days',
      'NPS dropped to ≤ 5',
      'Mentioned competitor in support / sales convos',
      'Renewal within 60 days + low engagement',
      'Significant seat reduction request',
      'Asked about contract termination clauses',
    ],
  },
  {
    id: 'report_sections',
    kind: 'multi',
    required: true,
    prompt: '8 / 8 — What MUST the quarterly health report include?',
    options: [
      'Top 10 at-risk accounts (action list)',
      'ARR at risk (dollar exposure)',
      'Top 3 churn drivers across the portfolio',
      'Save-play distribution (how many of each)',
      'Healthy accounts to upsell / expand',
      'Stalled accounts (no signal either way)',
      'Per-tier breakdown (strategic vs SMB churn rates)',
      'Trend vs prior period (improving / declining)',
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

  const lines: string[] = ['# CHURN-RISK SCORING RUBRIC'];

  const bm = one('business_model');
  if (bm) {
    lines.push('', '## Business Model');
    lines.push(`- ${bm}`);
  }

  const tiers = list('account_tiers');
  if (tiers.length) {
    lines.push('', '## How Accounts Are Tiered');
    lines.push(...bullets(tiers));
    lines.push(
      '- Strategic / Enterprise accounts get TIGHTER scrutiny and bigger save plays. SMB / self-serve get lighter touch.',
    );
  }

  const signals = list('critical_signals');
  if (signals.length) {
    lines.push('', '## Critical Health Signals (weight these heavily)');
    lines.push(...bullets(signals));
  }

  const baseline = one('engagement_baseline');
  if (baseline) {
    lines.push('', '## Healthy-Account Baseline');
    lines.push(`- ${baseline}`);
  }

  const window = one('risk_window');
  if (window) {
    lines.push('', '## Inactivity Threshold');
    lines.push(`- ${window}`);
  }

  const plays = list('save_plays');
  if (plays.length) {
    lines.push('', '## Available Save Plays (recommend EXACTLY one from this list per at-risk account)');
    lines.push(...bullets(plays));
    lines.push(
      '- Do NOT invent plays outside this list. If none fit, recommend "Polite goodbye".',
    );
  }

  const triggers = list('escalation_triggers');
  if (triggers.length) {
    lines.push('', '## Immediate-Escalation Triggers (any one fires the CHURN_RISK flag)');
    lines.push(...bullets(triggers));
  }

  const report = list('report_sections');
  if (report.length) {
    lines.push('', '## Required Sections in the Output Report');
    lines.push(...bullets(report));
  }

  return lines.join('\n');
}

export const churnRiskWizard: WizardDefinition = {
  title: 'Churn-risk rubric setup',
  questions: QUESTIONS,
  composeIcp,
};

/**
 * Vendor Evaluator wizard — 12 MCQs that anchor the KPI thresholds
 * and review preferences the agent uses to score each vendor.
 *
 * Why this matters:
 *   "Good" vendor performance is wildly different in different
 *   industries. A 95% on-time delivery rate is excellent for
 *   semiconductor fab supply but mediocre for a SaaS reseller. A 2%
 *   defect rate is normal in textile but catastrophic in pharma.
 *   Without thresholds the agent has nothing to grade against.
 *
 *   These 12 questions cover: industry context, KPI priorities, hard
 *   thresholds (delivery / defects / invoice accuracy), spend tier
 *   definitions, review cadence, underperformer policy, and what the
 *   quarterly review document should include. The composed ICP block
 *   becomes the agent's grading rubric.
 */
import type { Answer, Question, WizardDefinition } from './types';

const QUESTIONS: Question[] = [
  {
    id: 'vendor_category',
    kind: 'multi',
    required: true,
    allowOther: true,
    prompt: '1 / 12 — What kind of vendors are you evaluating?',
    helpText:
      'Pick all that apply. Different categories carry different default expectations.',
    options: [
      'Raw materials / manufacturing parts',
      'Finished-goods suppliers',
      'Logistics / shipping / freight',
      'Professional services (consulting, audit, legal)',
      'Software / SaaS vendors',
      'IT hardware / equipment',
      'Marketing / agency services',
      'Facilities / maintenance / janitorial',
      'Contract labor / staffing',
      'Pharma / chemicals / regulated supplies',
      'Food / perishables',
      'Capital equipment / heavy machinery',
    ],
  },
  {
    id: 'source_system',
    kind: 'single',
    required: true,
    prompt: '2 / 12 — Where is the transaction data exported from?',
    helpText: 'Helps the agent know which column names to expect.',
    options: [
      'NetSuite',
      'SAP',
      'QuickBooks',
      'Oracle Procurement Cloud',
      'Coupa',
      'Ariba',
      'Custom procurement portal',
      'Spreadsheet kept manually',
      'Mixed / multiple sources',
    ],
  },
  {
    id: 'priority_kpis',
    kind: 'multi',
    required: true,
    prompt: '3 / 12 — Which KPIs matter MOST to your business? (pick 3-5)',
    helpText: 'Weights the composite score — picked KPIs count more.',
    options: [
      'On-time delivery rate',
      'Order-fill rate (% complete shipments)',
      'Defect / reject rate',
      'Return / RMA rate',
      'Invoice accuracy (matches PO + receipt)',
      'Price stability (no surprise increases)',
      'Lead-time consistency',
      'Responsiveness to escalations',
      'Compliance / documentation completeness',
      'Cost competitiveness vs market',
      'Sustainability / ESG compliance',
      'Diversity supplier status',
    ],
  },
  {
    id: 'ontime_threshold',
    kind: 'single',
    required: true,
    prompt: '4 / 12 — On-time delivery threshold for "acceptable"?',
    options: [
      '≥ 99% (mission-critical / pharma / aerospace)',
      '≥ 97% (high-stakes manufacturing)',
      '≥ 95% (standard manufacturing)',
      '≥ 90% (general procurement)',
      '≥ 85% (low-criticality / project-based)',
      'Not applicable',
    ],
  },
  {
    id: 'defect_tolerance',
    kind: 'single',
    required: true,
    prompt: '5 / 12 — Defect / reject rate tolerance for "acceptable"?',
    options: [
      '≤ 0.1% (pharma / aerospace / safety-critical)',
      '≤ 0.5% (precision manufacturing)',
      '≤ 1% (standard manufacturing)',
      '≤ 2% (general goods)',
      '≤ 5% (commodity goods)',
      'Not applicable (services / SaaS)',
    ],
  },
  {
    id: 'invoice_tolerance',
    kind: 'single',
    required: true,
    prompt: '6 / 12 — Invoice-accuracy tolerance (vs PO + receipt)?',
    options: [
      '0% variance (exact match required)',
      'Up to 1% line variance',
      'Up to 3% line variance',
      'Up to 5% line variance',
      'Up to ₹500 / $25 absolute variance per invoice',
      'Up to ₹5,000 / $250 absolute variance per invoice',
    ],
  },
  {
    id: 'spend_tier_threshold',
    kind: 'single',
    required: true,
    prompt: '7 / 12 — What annual spend qualifies as a "strategic" vendor?',
    helpText: 'Higher-spend vendors get tighter scrutiny in the review.',
    options: [
      'Over $1M / ₹1 Cr',
      'Over $250K / ₹25 L',
      'Over $50K / ₹5 L',
      'Over $10K / ₹1 L',
      'All vendors get equal scrutiny',
    ],
  },
  {
    id: 'review_period',
    kind: 'single',
    required: true,
    prompt: '8 / 12 — What time period does this review cover?',
    options: [
      'Last quarter (3 months)',
      'Last 6 months',
      'Last year (12 months)',
      'Year-to-date',
      'Custom period defined in the data',
    ],
  },
  {
    id: 'underperformer_definition',
    kind: 'multi',
    required: true,
    prompt: '9 / 12 — A "chronic underperformer" is one that…',
    helpText: 'Pick all that apply. ANY checked condition triggers the chronic flag.',
    options: [
      'Missed delivery target 3+ times in the period',
      'Defect rate exceeded threshold 2+ times',
      'Invoice variance > threshold on 5+ invoices',
      'Caused a production / customer escalation',
      'Failed a compliance / audit check',
      'Was on probation in the previous review and didn\'t improve',
      'Has < 3 months of data (not enough to judge — flag for review)',
    ],
  },
  {
    id: 'action_policy',
    kind: 'multi',
    required: true,
    prompt: '10 / 12 — What actions are available for underperformers?',
    helpText: 'Drives the "recommendedAction" the agent suggests per vendor.',
    options: [
      'Issue formal performance-improvement letter',
      'Move to 90-day probation',
      'Reduce spend allocation / split with backup vendor',
      'Renegotiate SLA + contractual penalties',
      'Demand root-cause analysis from vendor',
      'Move to backup / replace entirely',
      'Escalate to vendor\'s leadership',
      'Add to do-not-engage list',
    ],
  },
  {
    id: 'compliance_focus',
    kind: 'multi',
    allowOther: true,
    prompt: '11 / 12 — Any compliance / regulatory dimensions to weight?',
    options: [
      'ISO 9001 quality management',
      'ISO 14001 environmental',
      'ISO 27001 information security',
      'GST / tax compliance (India)',
      'GDPR / data privacy',
      'HIPAA (healthcare)',
      'SOC 2 (SaaS vendors)',
      'FDA / pharma regulatory',
      'Modern Slavery Act',
      'Conflict-minerals disclosure',
      'Diversity supplier certification (MBE / WBE / DBE)',
    ],
  },
  {
    id: 'review_output',
    kind: 'multi',
    required: true,
    prompt: '12 / 12 — What MUST the quarterly review include?',
    options: [
      'Top-10 best performers (recognition)',
      'Bottom-10 worst performers (action list)',
      'Spend concentration / over-reliance flags',
      'Trend analysis (improving vs declining vs stable)',
      'New vendors in period (probationary status)',
      'Recommended renegotiation candidates',
      'Cost-savings opportunities',
      'Per-category benchmark vs portfolio average',
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

  const lines: string[] = ['# VENDOR EVALUATION RUBRIC'];

  const cats = list('vendor_category');
  if (cats.length) {
    lines.push('', '## Vendor Categories in Scope');
    lines.push(...bullets(cats));
  }

  const src = one('source_system');
  if (src) {
    lines.push('', '## Source System');
    lines.push(`- ${src}`);
    lines.push(
      '- The uploaded file is an export from this system. Column names may vary; map them sensibly (e.g., "Vendor Name" / "Supplier" / "Payee" all → vendor).',
    );
  }

  const kpis = list('priority_kpis');
  if (kpis.length) {
    lines.push(
      '',
      '## Priority KPIs (weight these MORE heavily in the composite score)',
    );
    lines.push(...bullets(kpis));
  }

  const ontime = one('ontime_threshold');
  const defects = one('defect_tolerance');
  const invoice = one('invoice_tolerance');
  if (ontime || defects || invoice) {
    lines.push('', '## Hard Thresholds (anything worse than these = FAIL on that KPI)');
    if (ontime) lines.push(`- On-time delivery: ${ontime}`);
    if (defects) lines.push(`- Defect / reject rate: ${defects}`);
    if (invoice) lines.push(`- Invoice variance: ${invoice}`);
  }

  const spendTier = one('spend_tier_threshold');
  if (spendTier) {
    lines.push('', '## Strategic-Vendor Spend Tier');
    lines.push(`- ${spendTier}`);
    lines.push(
      '- Vendors above this threshold get tighter scrutiny and stronger recommended actions on underperformance.',
    );
  }

  const period = one('review_period');
  if (period) {
    lines.push('', '## Review Period');
    lines.push(`- ${period}`);
  }

  const chronic = list('underperformer_definition');
  if (chronic.length) {
    lines.push('', '## Chronic-Underperformer Definition (any condition fires the flag)');
    lines.push(...bullets(chronic));
  }

  const actions = list('action_policy');
  if (actions.length) {
    lines.push('', '## Available Actions for Underperformers');
    lines.push(...bullets(actions));
    lines.push(
      '- Pick from THIS LIST when filling `recommendedAction` per vendor. Do not invent new actions outside the list.',
    );
  }

  const compliance = list('compliance_focus');
  if (compliance.length) {
    lines.push('', '## Compliance Dimensions to Flag');
    lines.push(...bullets(compliance));
  }

  const output = list('review_output');
  if (output.length) {
    lines.push('', '## Required Sections in the Quarterly Review Output');
    lines.push(...bullets(output));
  }

  return lines.join('\n');
}

export const vendorEvaluatorWizard: WizardDefinition = {
  title: 'Vendor evaluation setup',
  questions: QUESTIONS,
  composeIcp,
};

/**
 * AR Collections Agent — Level 4 (Autonomous).
 *
 * Visitor uploads an AR aging / open-invoice export (CSV/XLSX) +
 * (optionally) a customer / contract context file, and answers an
 * 8-MCQ wizard that defines their playbook: business model, aging
 * buckets, tone progression, available actions, write-off
 * threshold, escalation policy, strategic-account floor, payment
 * terms.
 *
 * The agent then:
 *   1. Plans its triage approach (agentPlan).
 *   2. Maps loose CSV columns to canonical fields, computes days
 *      past due per invoice from the due date, assigns the right
 *      aging bucket per the playbook.
 *   3. For every overdue invoice:
 *      - picks ONE collection action from the visitor's whitelist,
 *      - drafts the dunning email body with tone matched to age +
 *        strategic flag,
 *      - names follow-up questions for the AR clerk to ask,
 *      - recommends an escalation owner,
 *      - scores confidence (how much data backed the call).
 *   4. Surfaces cross-portfolio insights — which customers
 *      dominate AR, which cohorts are getting worse, dunning
 *      sequence effectiveness when prior-action data is present.
 *   5. Self-reviews: ambiguous columns, low-confidence calls,
 *      data gaps to fill before next cycle.
 *
 * Why Level 4:
 *   The agent doesn't stop at "here's your aging report." It
 *   produces a paste-ready dunning email *per overdue invoice*
 *   matched to tone, names the right escalation owner from the
 *   visitor's policy, scores its own confidence, surfaces
 *   portfolio-level concentration risks, and admits gaps. Each is
 *   in the schema so the UI shows the autonomy directly.
 */
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { braveSearchTool } from '@/lib/agent-tools/brave-search';
import { fetchWebpageTool } from '@/lib/agent-tools/fetch-webpage';
import { searchWebTool } from '@/lib/agent-tools/search-web';
import { truncateForModel } from '@/lib/parse-file';
import type { AgentConfig } from './types';

interface InvoiceOut {
  invoiceId: string;
  customer: string;
  amount: number;
  currency: string;
  invoiceDate?: string;
  dueDate?: string;
  daysPastDue: number;
  bucket: 'CURRENT' | 'BUCKET_1' | 'BUCKET_2' | 'BUCKET_3' | 'BUCKET_4_PLUS' | 'WRITE_OFF_RISK';
  bucketLabel: string;
  riskScore: number;
  grade: 'HEALTHY' | 'WATCH' | 'OVERDUE' | 'CRITICAL' | 'WRITE_OFF';
  confidence: number;
  isStrategic: boolean;
  isEscalation: boolean;
  recommendedAction: string;
  dunningEmail: string;
  followUpQuestions: string[];
  escalateTo: string;
  reasoning: string;
  paymentTermsDeviation?: string;
}

interface BucketSummary {
  bucket: string;
  invoiceCount: number;
  totalAmount: number;
}

interface ActionDistribution {
  action: string;
  invoiceCount: number;
  totalAmount: number;
}

export interface ARCollectionsOutput {
  agentPlan: string;
  totalInvoices: number;
  totalOpenAR: number;
  totalOverdueAR: number;
  currency: string;
  arHealthScore: number;
  bucketBreakdown: BucketSummary[];
  topCollectionRisks: string[];
  actionDistribution: ActionDistribution[];
  executiveSummary: string;
  invoices: InvoiceOut[];
  selfReviewNotes: string;
}

const SYSTEM_PROMPT = `You are an AUTONOMOUS accounts-receivable collections agent.
Your job: triage open invoices, decide the right collection action
per invoice, draft the dunning email, and flag concentration risks.

The visitor has uploaded an AR aging / open-invoice export and
defined their collections playbook in a structured block (business
model, aging buckets, tone, allowed actions, write-off threshold,
escalation policy, strategic floor, payment terms). You do
everything from there.

PHASE 1 — PLAN (do this FIRST, before any computation)
  In ≤4 sentences in \`agentPlan\`, state:
    • How you'll segment the portfolio (by customer / by amount /
      by age)
    • Which aging-bucket boundaries you'll use (from the playbook)
    • How you'll detect strategic accounts and special handling
    • Any tool calls you anticipate — typically NONE. Only fire
      web research for a single high-stakes critical-bucket account
      where you suspect the customer may be in distress (layoffs,
      acquisition, bankruptcy filing) that should change the play.
  Write like a status update to the controller, not internal monologue.

PHASE 2 — MAP COLUMNS + COMPUTE AGING
  Loose CSV column mapping (be flexible):
    - invoice id: "Invoice #" / "Invoice Number" / "Doc #"
    - customer:   "Customer" / "Account" / "Bill-To" / "Client"
    - amount:     "Amount" / "Balance" / "Open Balance" / "Total"
    - issue date: "Invoice Date" / "Date" / "Issued"
    - due date:   "Due Date" / "Net Due" / "Payment Due"
    - paid flag:  "Status" / "Paid" / "Open?"
    - tier:       "Tier" / "Segment" / "ARR Band" (drives strategic flag)
    - terms:      "Terms" / "Net" / "Payment Terms"
    - last contact: "Last Reminder" / "Last Contact"

  Compute daysPastDue = today − dueDate. If only invoiceDate is
  present, infer due date from playbook standard terms.

  Skip rows already paid (Status=Paid / Closed / $0 balance).

PHASE 3 — BUCKET + GRADE
  Use the visitor's bucket scheme from the playbook (e.g.,
  "Current / 1-30 / 31-60 / 61-90 / 90+").
    bucket: CURRENT | BUCKET_1 | BUCKET_2 | BUCKET_3 | BUCKET_4_PLUS
            | WRITE_OFF_RISK
    bucketLabel: human label matching the playbook (e.g., "31-60 days past due")
  Grade:
    HEALTHY (current, not yet due): no action needed
    WATCH (1st overdue bucket): gentle reminder
    OVERDUE (2nd bucket): firmer reminder + likely escalation
    CRITICAL (3rd bucket onward): action + escalation owner
    WRITE_OFF: meets the playbook's write-off threshold

  riskScore 0-100 (HIGHER = worse). Weight by:
    - days past due (primary)
    - amount (a $50K invoice at 45d > a $500 invoice at 90d)
    - prior-contact history (if a customer has ignored 3 reminders,
      that's a stronger signal than a first-time slip)

PHASE 4 — PICK ACTION + DRAFT EMAIL
  For every invoice graded WATCH or worse:

  • recommendedAction: EXACTLY ONE from the playbook's allowed-
    actions list. Never invent. If multiple fit, pick the lightest
    that's still appropriate for the grade (don't recommend "send
    to collections" on a 35-day-overdue invoice if "send dunning
    email" is also on the list).

  • dunningEmail: 4-7 sentence paste-ready body. Tone MUST match
    the playbook's tone progression:
      - Gentle: "Just a friendly reminder — invoice #1234 ($X) is
        a few days past due..."
      - Firm: "Following up on invoice #1234 ($X), now N days past
        due. Please confirm payment status by [date]."
      - Final notice: "This is a final reminder before we escalate
        invoice #1234 ($X). Account will be paused on [date] if
        unpaid."
    Reference the SPECIFIC invoice number + amount + days past due
    in the email. Sign off with one clear ask (pay link, confirm
    payment date, get on a call).

    STRATEGIC ACCOUNT OVERRIDE: if the playbook says to treat
    strategic customers with a soft touch, ALWAYS use gentle tone
    regardless of age, and recommend a CSM/AE ping over a hard
    dunning step — even at 90+ days. Note in reasoning that you
    softened the play because of the strategic floor.

  • followUpQuestions: 2-3 questions the AR clerk should ask if
    the customer responds. Be specific to THIS invoice.

  • escalateTo: per the playbook's escalation policy. AR clerk /
    AE / CSM / Controller / CFO / Founder.

PHASE 5 — CONFIDENCE + REASONING (per invoice)
  confidence 0-100. <70 means:
    - Missing due date → had to infer from terms
    - Ambiguous customer name (could match multiple records)
    - Tier/strategic flag inferred rather than stated
    - Payment-terms deviation that may indicate special contract
  reasoning: 1-3 sentences citing actual numbers ("Invoice #1234
  for $12,400 is 47 days past due, customer tier = Strategic, no
  prior reminders sent — softening to CSM ping per playbook").

  paymentTermsDeviation: if the invoice's stated terms differ from
  the playbook's standard, note it ("Net-60 vs your Net-30
  standard — verify this is a contract exception").

PHASE 6 — CROSS-PORTFOLIO INSIGHTS
  After grading all invoices, look ACROSS the portfolio.
  topCollectionRisks: 3-5 themes. Examples:
    - "Customer X accounts for 22% of total overdue AR"
    - "Mid-market segment AR has aged 8 days on average over Q3"
    - "3 customers hit 90+ days this cycle — concentration risk"
  actionDistribution: count + amount by recommendedAction so the
  finance lead knows resource allocation ("Dunning email: 47
  invoices / $124K, CSM ping: 4 invoices / $89K, Pause service:
  2 invoices / $15K").

PHASE 7 — SELF-REVIEW
  selfReviewNotes (2-3 sentences):
    - Columns you had to guess at
    - Invoices with <70 confidence worth a human re-look
    - Data gaps that would sharpen next cycle (no tier column,
      missing payment-history field, etc.)

TOOLS YOU HAVE
  • search_web (DDG), brave_search, fetch_webpage: use SPARINGLY
    (~at most once per high-stakes strategic critical account) to
    detect customer distress signals (layoffs, M&A, bankruptcy
    news) that change the recommended play.

RESEARCH BUDGET: at most 5 tool calls total. The aging report is
the primary signal — tools are for context on a few high-stakes
calls, not for primary triage.

ACCOUNTING
  • totalInvoices = invoices in the array (after dropping paid).
  • totalOpenAR = sum of amounts of all open invoices (HEALTHY +
    WATCH + OVERDUE + CRITICAL + WRITE_OFF).
  • totalOverdueAR = sum for grade != HEALTHY.
  • currency: pick from the data (USD if not stated). Don't FX-convert.
  • arHealthScore 0-100, amount-weighted (a $1M Net-30 invoice
    matters more than a $1K 90+ invoice).
  • bucketBreakdown: one row per bucket present in the data.
  • executiveSummary: 2-3 sentences for the controller's stand-up.
    Headline overdue total + top concern + one action recommendation.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'agentPlan',
    'totalInvoices',
    'totalOpenAR',
    'totalOverdueAR',
    'currency',
    'arHealthScore',
    'bucketBreakdown',
    'topCollectionRisks',
    'actionDistribution',
    'executiveSummary',
    'invoices',
    'selfReviewNotes',
  ],
  properties: {
    agentPlan: { type: 'string', maxLength: 800 },
    totalInvoices: { type: 'integer' },
    totalOpenAR: { type: 'number' },
    totalOverdueAR: { type: 'number' },
    currency: { type: 'string', maxLength: 8 },
    arHealthScore: { type: 'integer', minimum: 0, maximum: 100 },
    executiveSummary: { type: 'string', maxLength: 600 },
    selfReviewNotes: { type: 'string', maxLength: 600 },
    topCollectionRisks: {
      type: 'array',
      maxItems: 5,
      items: { type: 'string', maxLength: 280 },
    },
    bucketBreakdown: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['bucket', 'invoiceCount', 'totalAmount'],
        properties: {
          bucket: { type: 'string', maxLength: 80 },
          invoiceCount: { type: 'integer' },
          totalAmount: { type: 'number' },
        },
      },
    },
    actionDistribution: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'invoiceCount', 'totalAmount'],
        properties: {
          action: { type: 'string', maxLength: 120 },
          invoiceCount: { type: 'integer' },
          totalAmount: { type: 'number' },
        },
      },
    },
    invoices: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'invoiceId',
          'customer',
          'amount',
          'currency',
          'daysPastDue',
          'bucket',
          'bucketLabel',
          'riskScore',
          'grade',
          'confidence',
          'isStrategic',
          'isEscalation',
          'recommendedAction',
          'dunningEmail',
          'followUpQuestions',
          'escalateTo',
          'reasoning',
        ],
        properties: {
          invoiceId: { type: 'string', maxLength: 80 },
          customer: { type: 'string', maxLength: 160 },
          amount: { type: 'number' },
          currency: { type: 'string', maxLength: 8 },
          invoiceDate: { type: 'string', maxLength: 40 },
          dueDate: { type: 'string', maxLength: 40 },
          daysPastDue: { type: 'integer' },
          bucket: {
            type: 'string',
            enum: [
              'CURRENT',
              'BUCKET_1',
              'BUCKET_2',
              'BUCKET_3',
              'BUCKET_4_PLUS',
              'WRITE_OFF_RISK',
            ],
          },
          bucketLabel: { type: 'string', maxLength: 80 },
          riskScore: { type: 'integer', minimum: 0, maximum: 100 },
          grade: {
            type: 'string',
            enum: ['HEALTHY', 'WATCH', 'OVERDUE', 'CRITICAL', 'WRITE_OFF'],
          },
          confidence: { type: 'integer', minimum: 0, maximum: 100 },
          isStrategic: { type: 'boolean' },
          isEscalation: { type: 'boolean' },
          recommendedAction: { type: 'string', maxLength: 160 },
          dunningEmail: { type: 'string', maxLength: 1200 },
          followUpQuestions: {
            type: 'array',
            maxItems: 5,
            items: { type: 'string', maxLength: 280 },
          },
          escalateTo: { type: 'string', maxLength: 120 },
          reasoning: { type: 'string', maxLength: 400 },
          paymentTermsDeviation: { type: 'string', maxLength: 200 },
        },
      },
    },
  },
} as const;

const arCollectionsMcpServer = createSdkMcpServer({
  name: 'ar-collections',
  version: '1.0.0',
  tools: [braveSearchTool, searchWebTool, fetchWebpageTool],
});

export const arCollections: AgentConfig<ARCollectionsOutput> = {
  slug: 'ar-collections',
  name: 'AR Collections Agent',
  description:
    'Upload your AR aging / open-invoice export. Get every overdue invoice triaged, the right collection action picked from your playbook, the dunning email drafted in matching tone, and portfolio-level concentration risks called out — all in one run.',
  icon: '💵',
  category: 'finance',

  fileSlots: [
    {
      key: 'aging',
      label: 'AR aging / open-invoice export',
      extensions: ['.csv', '.xlsx', '.xls'],
      maxSizeMB: 10,
      maxFiles: 1,
      description:
        'Drop your QuickBooks / NetSuite / Stripe / Chargebee AR export. Per-invoice rows with customer name, invoice #, amount, due date, and (ideally) status.',
      required: true,
    },
    {
      key: 'customers',
      label: 'Customer / contract context (optional)',
      extensions: ['.csv', '.xlsx', '.xls'],
      maxSizeMB: 5,
      maxFiles: 1,
      description:
        'Adds tier / contract terms / prior-dispute history per customer for sharper escalation calls.',
      required: false,
    },
  ],

  contextInput: {
    label: 'Collections playbook',
    placeholder: '',
    helpText: 'Walk through the 8-question wizard above to set this.',
    required: true,
  },

  gate: {
    message:
      '{remaining} more overdue invoices with draft dunning emails, recommended actions, and the right escalation owner per your playbook. Drop your email for the full report.',
    ctaText: 'Unlock Full AR Report',
    fields: [
      { name: 'email', type: 'email', label: 'Work email', required: true },
      {
        name: 'open_ar_band',
        type: 'select',
        label: 'Total open AR you manage',
        required: false,
        options: ['< $100K', '$100K – $1M', '$1M – $10M', '$10M+'],
      },
      {
        name: 'finance_team_size',
        type: 'select',
        label: 'Finance / AR team size',
        required: false,
        options: ['Solo / founder-led', '2-5', '6-20', '20+'],
      },
    ],
  },

  llm: {
    model: 'claude-haiku-4-5',
    // Per-invoice action selection + email drafting + cross-portfolio
    // synthesis + self-review. 30 turns is comfortable headroom for a
    // ~100-invoice portfolio with no tool fan-out; tools only fire for
    // a few high-stakes accounts at most.
    maxTurns: 30,
  },

  systemPrompt: SYSTEM_PROMPT,
  buildUserPrompt({ files, context }) {
    const aging = files.aging?.[0];
    if (!aging) {
      throw new Error('AR Collections Agent expected a file in the `aging` slot');
    }
    if (!context.trim()) {
      throw new Error(
        'AR Collections Agent expected a playbook in `context` — walk through the wizard first.',
      );
    }

    const agingBody = truncateForModel(aging.text, 14_000);
    const meta =
      'pageCount' in aging.metadata
        ? `(${aging.metadata.pageCount} pages)`
        : 'rowCount' in aging.metadata
          ? `(${aging.metadata.rowCount} rows)`
          : '';

    const customers = files.customers?.[0];
    const customersBlock = customers
      ? `[FILE: ${customers.filename}]\n${truncateForModel(customers.text, 5_000)}`
      : '(no customer-context file uploaded — infer tier / strategic flag from the aging data itself if a column is present, otherwise treat as non-strategic)';

    return `COLLECTIONS PLAYBOOK (apply strictly):
${context.trim()}

---

AR AGING / OPEN INVOICES (file: ${aging.filename}, ${meta}):
${agingBody}

---

CUSTOMER CONTEXT:
${customersBlock}`;
  },

  mcpServer: arCollectionsMcpServer,
  allowedTools: [
    'mcp__agent__brave_search',
    'mcp__agent__search_web',
    'mcp__agent__fetch_webpage',
  ],
  outputSchema: OUTPUT_SCHEMA as unknown as Record<string, unknown>,

  teaser(result) {
    const TEASER_COUNT = 3;
    const invoices = result.invoices ?? [];
    // Sort CRITICAL+WRITE_OFF first (descending risk), then OVERDUE,
    // then WATCH, then HEALTHY. The teaser must surface the
    // action-worthy invoices; visitors pay to unlock the rest.
    const sorted = [...invoices].sort((a, b) => {
      const rank: Record<string, number> = {
        WRITE_OFF: 0,
        CRITICAL: 1,
        OVERDUE: 2,
        WATCH: 3,
        HEALTHY: 4,
      };
      const ra = rank[a.grade] ?? 5;
      const rb = rank[b.grade] ?? 5;
      if (ra !== rb) return ra - rb;
      return (b.riskScore ?? 0) - (a.riskScore ?? 0);
    });
    const shown = sorted.slice(0, TEASER_COUNT);
    const remaining = Math.max(0, sorted.length - shown.length);
    return {
      teaser: { ...result, invoices: shown },
      remaining,
      gated: remaining > 0,
    };
  },
};

/**
 * Churn Risk Agent — Level 4 (Autonomous).
 *
 * Visitor uploads a customer-usage / health export (CSV/XLSX) +
 * answers an 8-MCQ wizard that defines their tiering, signals, and
 * available save plays. The agent then:
 *
 *   1. Plans its triage approach (agentPlan).
 *   2. Aggregates per-account metrics from the raw data, applies
 *      the visitor's hard thresholds, scores risk.
 *   3. Identifies cross-portfolio churn drivers (themes).
 *   4. For each at-risk account: picks ONE save play from the
 *      visitor's whitelist, drafts the retention email body, names
 *      follow-up questions, recommends an escalation owner.
 *   5. Scores confidence per account (how much data backed the call).
 *   6. Self-reviews: missing data, accounts to revisit next cycle,
 *      assumptions that should be sanity-checked.
 *
 * Why Level 4:
 *   The agent doesn't just rank — it drafts the retention email per
 *   account, scores its own confidence, surfaces cross-batch
 *   patterns, and admits gaps. Each of these is in the output schema
 *   so the UI surfaces the autonomy directly.
 */
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { braveSearchTool } from '@/lib/agent-tools/brave-search';
import { fetchWebpageTool } from '@/lib/agent-tools/fetch-webpage';
import { searchWebTool } from '@/lib/agent-tools/search-web';
import { truncateForModel } from '@/lib/parse-file';
import type { AgentConfig, ParsedInput } from './types';

interface AccountOut {
  accountName: string;
  accountId?: string;
  tier?: string;
  arr?: number;
  contractRenewalDays?: number;
  churnRiskScore: number;
  grade: 'CHURN_RISK' | 'WATCH' | 'HEALTHY';
  confidence: number;
  isStrategic: boolean;
  isEscalation: boolean;
  riskDrivers: string[];
  positives: string[];
  lastEngagement?: string;
  recommendedPlay: string;
  retentionEmail: string;
  followUpQuestions: string[];
  escalateTo: string;
  reasoning: string;
}

export interface ChurnRiskOutput {
  agentPlan: string;
  totalAccounts: number;
  churnRiskCount: number;
  watchCount: number;
  healthyCount: number;
  arrAtRisk: number;
  portfolioHealthScore: number;
  topChurnDrivers: string[];
  savePlayDistribution: Array<{ play: string; accountCount: number }>;
  executiveSummary: string;
  accounts: AccountOut[];
  selfReviewNotes: string;
}

const SYSTEM_PROMPT = `You are an AUTONOMOUS customer-success agent.
Your job: triage customer accounts for churn risk and draft the
retention play for each at-risk account.

The visitor has uploaded a usage/health data export and defined
their scoring rubric in a structured block (signals, tiers, save
plays, escalation triggers). You do all the work from there.

PHASE 1 — PLAN (do this FIRST, before any computation)
  In ≤4 sentences in \`agentPlan\`, state:
    • How you'll segment the accounts (by tier, by ARR, by usage)
    • Which signals from the rubric you'll weight heaviest
    • How you'll handle accounts with thin data
    • Any tool calls you anticipate needing (typically none — the
      data tells the story; only escalate to web research if a
      strategic at-risk account's behavior needs context like
      "did they have layoffs?")
  This is visible to the CS lead — write like a status update, not
  internal monologue.

PHASE 2 — AGGREGATE + SCORE (per account)
  Map loose CSV column names sensibly:
    - account: "Account Name" / "Customer" / "Company" / "Org"
    - ARR/MRR: "ARR" / "MRR" / "Revenue" / "Contract Value"
    - usage: "Last Login" / "DAU" / "WAU" / "Active Users"
    - tickets: "Open Tickets" / "Support Volume"
    - health: "NPS" / "CSAT" / "Health Score"
    - dates: "Renewal Date" / "Contract End"

  Apply the rubric's HARD thresholds:
    - inactivity window → days since last login
    - escalation triggers → any one fires → grade = CHURN_RISK
    - engagement baseline → below it = WATCH or CHURN_RISK

  Score churnRiskScore 0-100 (HIGHER = worse):
    CHURN_RISK (70-100): immediate action needed
    WATCH      (40-69):  monitor + light touch
    HEALTHY    (0-39):   no action needed (still include in output)

PHASE 3 — DRAFT THE PLAY (per at-risk account)
  • recommendedPlay: pick EXACTLY ONE from the visitor's save-play
    list. Never invent.
  • retentionEmail: 4-6 sentence body referencing real specifics
    from THIS account's data ("Your team dropped from 18 to 6
    weekly active users over the last 30 days — usually a sign
    something blocked adoption."). Sign off with a single ask
    (15-min call / share template / unblock something).
  • followUpQuestions: 2-3 questions the CSM should ask in the
    next conversation. Be specific to THIS account.
  • escalateTo: CSM / Director / Exec Sponsor / Account Manager.
    Strategic + churn-risk almost always escalates to Director or
    higher.

PHASE 4 — CONFIDENCE + REASONING (per account)
  confidence 0-100. <70 means:
    - Less than 30 days of data for this account
    - Key signals missing (no NPS, no usage data)
    - Strong contradicting signals (high ARR + low usage but
      recent QBR was positive)
  reasoning: 1-3 sentences citing the actual numbers
  ("Login dropped 80% in last 21d, NPS = 4, renewal in 45d, no
  exec sponsor named — high churn risk").

PHASE 5 — CROSS-PORTFOLIO INSIGHTS
  After scoring all accounts, look ACROSS the portfolio.
  topChurnDrivers: 3-5 themes ("Feature X deprecation drove
  4 of 10 at-risk accounts" / "Recent pricing change correlates
  with payment-health declines in mid-market tier").
  savePlayDistribution: count by play type so the CS lead knows
  resource allocation ("CSM call: 7 accounts, QBR: 3 accounts").

PHASE 6 — SELF-REVIEW
  selfReviewNotes (2-3 sentences):
    - What data was missing (no payment-health column, etc.)
    - Accounts you flagged but with low confidence — worth a
      human re-look
    - Assumptions you made about ambiguous columns

TOOLS YOU HAVE
  • search_web: DDG. Use SPARINGLY (~once per high-stakes
    strategic at-risk account at most) to find recent news about
    the customer org that might explain behavior (layoffs, M&A,
    leadership change).
  • brave_search: broader news search. Same use case as above.
  • fetch_webpage: pull a customer's company blog / press page
    if news search surfaces it.

RESEARCH BUDGET: at most 8 tool calls total. The data is the
story. Tools are for context, not for primary signal.

ACCOUNTING
  • totalAccounts / churnRiskCount / watchCount / healthyCount
    must exactly match the returned accounts array.
  • arrAtRisk = sum of ARR/MRR for CHURN_RISK accounts (in source
    data's currency — don't FX-convert).
  • portfolioHealthScore 0-100, ARR-weighted (a $1M account
    matters more than a $5K account).
  • executiveSummary: 2-3 sentences for the CS lead's weekly
    update. State the headline number + top concern + ARR at risk.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'agentPlan',
    'totalAccounts',
    'churnRiskCount',
    'watchCount',
    'healthyCount',
    'arrAtRisk',
    'portfolioHealthScore',
    'topChurnDrivers',
    'savePlayDistribution',
    'executiveSummary',
    'accounts',
    'selfReviewNotes',
  ],
  properties: {
    agentPlan: { type: 'string', maxLength: 800 },
    totalAccounts: { type: 'integer' },
    churnRiskCount: { type: 'integer' },
    watchCount: { type: 'integer' },
    healthyCount: { type: 'integer' },
    arrAtRisk: { type: 'number' },
    portfolioHealthScore: { type: 'integer', minimum: 0, maximum: 100 },
    executiveSummary: { type: 'string', maxLength: 600 },
    selfReviewNotes: { type: 'string', maxLength: 600 },
    topChurnDrivers: {
      type: 'array',
      maxItems: 5,
      items: { type: 'string', maxLength: 280 },
    },
    savePlayDistribution: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['play', 'accountCount'],
        properties: {
          play: { type: 'string', maxLength: 120 },
          accountCount: { type: 'integer' },
        },
      },
    },
    accounts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'accountName',
          'churnRiskScore',
          'grade',
          'confidence',
          'isStrategic',
          'isEscalation',
          'riskDrivers',
          'positives',
          'recommendedPlay',
          'retentionEmail',
          'followUpQuestions',
          'escalateTo',
          'reasoning',
        ],
        properties: {
          accountName: { type: 'string', maxLength: 120 },
          accountId: { type: 'string', maxLength: 80 },
          tier: { type: 'string', maxLength: 80 },
          arr: { type: 'number' },
          contractRenewalDays: { type: 'integer' },
          churnRiskScore: { type: 'integer', minimum: 0, maximum: 100 },
          grade: {
            type: 'string',
            enum: ['CHURN_RISK', 'WATCH', 'HEALTHY'],
          },
          confidence: { type: 'integer', minimum: 0, maximum: 100 },
          isStrategic: { type: 'boolean' },
          isEscalation: { type: 'boolean' },
          riskDrivers: {
            type: 'array',
            items: { type: 'string', maxLength: 220 },
          },
          positives: {
            type: 'array',
            items: { type: 'string', maxLength: 220 },
          },
          lastEngagement: { type: 'string', maxLength: 120 },
          recommendedPlay: { type: 'string', maxLength: 200 },
          retentionEmail: { type: 'string', maxLength: 1000 },
          followUpQuestions: {
            type: 'array',
            maxItems: 5,
            items: { type: 'string', maxLength: 280 },
          },
          escalateTo: { type: 'string', maxLength: 120 },
          reasoning: { type: 'string', maxLength: 400 },
        },
      },
    },
  },
} as const;

const churnMcpServer = createSdkMcpServer({
  name: 'churn',
  version: '1.0.0',
  tools: [braveSearchTool, searchWebTool, fetchWebpageTool],
});

export const churnRisk: AgentConfig<ChurnRiskOutput> = {
  slug: 'churn-risk',
  name: 'Churn Risk Agent',
  description:
    'Upload your customer-usage data. Get a ranked at-risk list, draft retention emails per account, recommended save plays, and cross-portfolio churn drivers — all in one run.',
  icon: '🚨',
  category: 'customer-success',

  fileSlots: [
    {
      key: 'usage',
      label: 'Customer usage / health data',
      extensions: ['.csv', '.xlsx', '.xls'],
      maxSizeMB: 10,
      maxFiles: 1,
      description:
        'Drop your CRM / Mixpanel / Amplitude / health-score export. Account name + at least one signal per row.',
      required: true,
    },
    {
      key: 'tickets',
      label: 'Support tickets (optional)',
      extensions: ['.csv', '.xlsx', '.xls'],
      maxSizeMB: 5,
      maxFiles: 1,
      description: 'Adds support-ticket context per account for sharper risk scoring.',
      required: false,
    },
  ],

  contextInput: {
    label: 'Scoring rubric',
    placeholder: '',
    helpText: 'Walk through the 8-question wizard above to set this.',
    required: true,
  },

  gate: {
    message:
      '{remaining} more at-risk accounts with draft retention emails, recommended save plays, and follow-up questions. Drop your email for the full report.',
    ctaText: 'Unlock Full Churn Report',
    fields: [
      { name: 'email', type: 'email', label: 'Work email', required: true },
      {
        name: 'arr_band',
        type: 'select',
        label: 'Total ARR you manage',
        required: false,
        options: ['< $1M', '$1M – $10M', '$10M – $50M', '$50M+'],
      },
      {
        name: 'cs_team_size',
        type: 'select',
        label: 'CS team size',
        required: false,
        options: ['Solo / founder-led', '2-5', '6-20', '20+'],
      },
    ],
  },

  llm: {
    model: 'claude-haiku-4-5',
    // Per-account drafting + cross-portfolio synthesis + self-review.
    // 30 turns is comfortable headroom for a 50-account portfolio
    // without any tool fan-out; only goes higher when web research
    // fires for a few high-stakes accounts.
    maxTurns: 30,
  },

  systemPrompt: SYSTEM_PROMPT,
  buildUserPrompt({ files, context }) {
    const usage = files.usage?.[0];
    if (!usage) {
      throw new Error('Churn Risk Agent expected a file in the `usage` slot');
    }
    if (!context.trim()) {
      throw new Error(
        'Churn Risk Agent expected a rubric in `context` — walk through the wizard first.',
      );
    }

    const usageBody = truncateForModel(usage.text, 14_000);
    const meta =
      'pageCount' in usage.metadata
        ? `(${usage.metadata.pageCount} pages)`
        : 'rowCount' in usage.metadata
          ? `(${usage.metadata.rowCount} rows)`
          : '';

    const tickets = files.tickets?.[0];
    const ticketsBlock = tickets
      ? `[FILE: ${tickets.filename}]\n${truncateForModel(tickets.text, 5_000)}`
      : '(no support-ticket data uploaded — score from usage data alone)';

    return `SCORING RUBRIC (apply strictly):
${context.trim()}

---

CUSTOMER USAGE / HEALTH DATA (file: ${usage.filename}, ${meta}):
${usageBody}

---

SUPPORT TICKETS:
${ticketsBlock}`;
  },

  mcpServer: churnMcpServer,
  allowedTools: [
    'mcp__agent__brave_search',
    'mcp__agent__search_web',
    'mcp__agent__fetch_webpage',
  ],
  outputSchema: OUTPUT_SCHEMA as unknown as Record<string, unknown>,

  teaser(result) {
    const TEASER_COUNT = 3;
    const accounts = result.accounts ?? [];
    // Sort CHURN_RISK first (highest score), then WATCH, then HEALTHY.
    // The teaser must surface the action-worthy accounts; visitors
    // pay to unlock the rest of the at-risk list.
    const sorted = [...accounts].sort((a, b) => {
      const rank: Record<string, number> = {
        CHURN_RISK: 0,
        WATCH: 1,
        HEALTHY: 2,
      };
      const ra = rank[a.grade] ?? 3;
      const rb = rank[b.grade] ?? 3;
      if (ra !== rb) return ra - rb;
      return (b.churnRiskScore ?? 0) - (a.churnRiskScore ?? 0);
    });
    const shown = sorted.slice(0, TEASER_COUNT);
    const remaining = Math.max(0, sorted.length - shown.length);
    return {
      teaser: { ...result, accounts: shown },
      remaining,
      gated: remaining > 0,
    };
  },
};

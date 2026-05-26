/**
 * Vendor Evaluator — quarterly vendor performance review agent.
 *
 * Visitor uploads a transaction export from their procurement / AP
 * system (NetSuite / SAP / QuickBooks / Coupa / etc.) plus answers a
 * KPI wizard. Agent computes per-vendor metrics, scores against the
 * thresholds the visitor defined, flags chronic underperformers, and
 * writes a quarterly review.
 *
 * Why this is genuinely useful (vs a pivot table):
 *   The hard part of vendor evaluation isn't aggregation — it's
 *   judgment. Which vendors deserve probation? Which deserve a
 *   renegotiation conversation? Which are mission-critical and need
 *   leadership-level escalation? An LLM with the visitor's thresholds
 *   + the raw transaction data can make those calls in plain English,
 *   citing the specific numbers that drove each recommendation. Pivot
 *   tables can't.
 *
 * Input shape:
 *   - Required: `transactions` slot — CSV or XLSX export with at
 *     least vendor name + some performance signal (delivery dates,
 *     defect counts, invoice variances — agent maps loose column
 *     names sensibly).
 *   - Optional: `contracts` slot — SLA / contract terms doc(s),
 *     PDFs or CSV with explicit per-vendor thresholds (overrides the
 *     wizard defaults for those specific vendors).
 *
 * Tools:
 *   - search_web / fetch_webpage for vendor context (lookups, parent
 *     companies, recent news that affects risk).
 *   - brave_search to find industry benchmarks ("average on-time
 *     delivery rate for semiconductor suppliers") when the visitor
 *     hasn't given hard numbers.
 *   - No new tool needed; existing toolset covers the use case.
 */
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { braveSearchTool } from '@/lib/agent-tools/brave-search';
import { fetchWebpageTool } from '@/lib/agent-tools/fetch-webpage';
import { searchWebTool } from '@/lib/agent-tools/search-web';
import { truncateForModel } from '@/lib/parse-file';
import type { AgentConfig, ParsedInput } from './types';

interface VendorEntry {
  vendorName: string;
  vendorId?: string;
  category?: string;
  spendInPeriod: number;
  currency?: string;
  transactionCount: number;
  metrics: {
    onTimeDeliveryRate?: number;
    defectRate?: number;
    invoiceAccuracyRate?: number;
    avgLeadTimeDays?: number;
    fillRate?: number;
  };
  compositeScore: number;
  grade: 'EXCELLENT' | 'GOOD' | 'NEEDS_REVIEW' | 'CHRONIC_UNDERPERFORMER';
  trend: 'IMPROVING' | 'STABLE' | 'DECLINING' | 'INSUFFICIENT_DATA';
  isStrategic: boolean;
  isChronic: boolean;
  keyIssues: string[];
  positives: string[];
  recommendedAction: string;
  reasoning: string;
  reviewNotes?: string;
}

export interface VendorEvaluatorOutput {
  reviewPeriod: string;
  totalVendors: number;
  totalSpendReviewed: number;
  topPerformerCount: number;
  needsReviewCount: number;
  chronicUnderperformerCount: number;
  newVendorCount: number;
  portfolioHealthScore: number;
  spendConcentrationWarning?: string;
  executiveSummary: string;
  vendors: VendorEntry[];
}

const SYSTEM_PROMPT = `You are a vendor performance evaluation agent for
a procurement / finance team. The visitor has uploaded a transaction
export and defined their KPI thresholds in a structured rubric.

YOUR JOB
  1. Parse the uploaded vendor transactions (they may come from
     NetSuite, SAP, QuickBooks, Coupa, Ariba, or a custom export).
     Column names vary — map sensibly:
       - vendor: "Vendor Name" / "Supplier" / "Payee" / "VendorID"
       - dates: "Order Date" / "PO Date" / "ETA" / "Actual Delivery"
       - quantities: "Qty Ordered" / "Qty Received" / "Qty Defective"
       - financials: "Invoice Amount" / "PO Amount" / "Variance"
  2. Aggregate per vendor for the review period defined in the rubric.
  3. Compute the priority KPIs (on-time delivery, defect rate, invoice
     accuracy, fill rate, lead time) from the raw data — show your
     work in the reasoning field, not just the percentages.
  4. Apply the visitor's hard thresholds to grade each vendor.
  5. Flag chronic underperformers per the visitor's definition
     (multiple condition options are listed in the rubric — ANY one
     hitting fires the chronic flag).
  6. Surface trend per vendor (improving / stable / declining) when
     the data has enough monthly granularity.
  7. Produce the quarterly review with the sections the visitor asked
     for in their rubric.

TOOLS YOU HAVE
  • search_web(query):     DDG lookup for known vendors.
  • brave_search(query):   Open web search. Use for finding industry
                           benchmarks when visitor didn't give hard
                           numbers ("average defect rate for sheet
                           metal stamping"). Also use to surface
                           recent news / risk events about a vendor.
  • fetch_webpage(url):    Pull a vendor's About page if you need
                           context on parent / ownership / scale.

RESEARCH BUDGET
  At most 10 tool calls total. Most of the work is data aggregation —
  not research. Use tool calls only when:
    - A flagged underperformer needs context (recent news, M&A, etc.)
    - The visitor's thresholds are blank and you need a benchmark
    - A vendor name is ambiguous and verification helps

GRADING
  EXCELLENT (90-100): meets or beats every priority KPI, no incidents,
                      consistent trend.
  GOOD (75-89):       meets most KPIs, minor misses on non-priority
                      metrics. Continue relationship as-is.
  NEEDS_REVIEW (50-74): missed one or more priority KPIs, OR has a
                      worrying trend. Schedule a review conversation.
  CHRONIC_UNDERPERFORMER (0-49): hits a chronic-flag condition from
                      the rubric. Recommend a concrete action from
                      the visitor's available actions list.

KEY OUTPUT RULES
  • Cite ACTUAL NUMBERS in reasoning ("87% on-time across 142 POs
    vs your 95% threshold = FAIL on priority KPI"). No fluff.
  • recommendedAction must be picked from the visitor's available-
    actions list. Do not invent new actions.
  • spendInPeriod is in the source-data currency (don't FX-convert).
  • If a vendor has < 3 months of data and the rubric flags that as
    chronic, mark them chronic with "insufficient data" as the
    primary reason.
  • portfolioHealthScore is 0-100, weighted by spend (a $1M vendor's
    performance matters more to the score than a $5K vendor's).
  • spendConcentrationWarning fires if any single vendor > 30% of
    total spend in the period, OR top-3 vendors > 60%.
  • executiveSummary is 2-4 sentences for the procurement lead's
    weekly update. State the headline number + top concern.
  • Set totalVendors / topPerformerCount / needsReviewCount /
    chronicUnderperformerCount / newVendorCount to exactly match
    the returned vendors array.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'reviewPeriod',
    'totalVendors',
    'totalSpendReviewed',
    'topPerformerCount',
    'needsReviewCount',
    'chronicUnderperformerCount',
    'newVendorCount',
    'portfolioHealthScore',
    'executiveSummary',
    'vendors',
  ],
  properties: {
    reviewPeriod: { type: 'string', maxLength: 80 },
    totalVendors: { type: 'integer' },
    totalSpendReviewed: { type: 'number' },
    topPerformerCount: { type: 'integer' },
    needsReviewCount: { type: 'integer' },
    chronicUnderperformerCount: { type: 'integer' },
    newVendorCount: { type: 'integer' },
    portfolioHealthScore: { type: 'integer', minimum: 0, maximum: 100 },
    spendConcentrationWarning: { type: 'string', maxLength: 400 },
    executiveSummary: { type: 'string', maxLength: 800 },
    vendors: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'vendorName',
          'spendInPeriod',
          'transactionCount',
          'metrics',
          'compositeScore',
          'grade',
          'trend',
          'isStrategic',
          'isChronic',
          'keyIssues',
          'positives',
          'recommendedAction',
          'reasoning',
        ],
        properties: {
          vendorName: { type: 'string', maxLength: 200 },
          vendorId: { type: 'string', maxLength: 80 },
          category: { type: 'string', maxLength: 80 },
          spendInPeriod: { type: 'number' },
          currency: { type: 'string', maxLength: 8 },
          transactionCount: { type: 'integer' },
          metrics: {
            type: 'object',
            additionalProperties: false,
            properties: {
              onTimeDeliveryRate: { type: 'number', minimum: 0, maximum: 100 },
              defectRate: { type: 'number', minimum: 0, maximum: 100 },
              invoiceAccuracyRate: { type: 'number', minimum: 0, maximum: 100 },
              avgLeadTimeDays: { type: 'number', minimum: 0 },
              fillRate: { type: 'number', minimum: 0, maximum: 100 },
            },
          },
          compositeScore: { type: 'integer', minimum: 0, maximum: 100 },
          grade: {
            type: 'string',
            enum: ['EXCELLENT', 'GOOD', 'NEEDS_REVIEW', 'CHRONIC_UNDERPERFORMER'],
          },
          trend: {
            type: 'string',
            enum: ['IMPROVING', 'STABLE', 'DECLINING', 'INSUFFICIENT_DATA'],
          },
          isStrategic: { type: 'boolean' },
          isChronic: { type: 'boolean' },
          keyIssues: { type: 'array', items: { type: 'string', maxLength: 220 } },
          positives: { type: 'array', items: { type: 'string', maxLength: 220 } },
          recommendedAction: { type: 'string', maxLength: 200 },
          reasoning: { type: 'string', maxLength: 400 },
          reviewNotes: { type: 'string', maxLength: 400 },
        },
      },
    },
  },
} as const;

const vendorMcpServer = createSdkMcpServer({
  name: 'vendor',
  version: '1.0.0',
  tools: [braveSearchTool, searchWebTool, fetchWebpageTool],
});

export const vendorEvaluator: AgentConfig<VendorEvaluatorOutput> = {
  slug: 'vendor-evaluator',
  name: 'Vendor Performance Evaluator',
  description:
    'Upload your procurement / AP transaction export. Get a per-vendor scorecard, chronic-underperformer flags, and a quarterly review ready to send.',
  icon: '📊',
  category: 'operations',

  fileSlots: [
    {
      key: 'transactions',
      label: 'Vendor transactions',
      extensions: ['.csv', '.xlsx', '.xls'],
      maxSizeMB: 10,
      maxFiles: 1,
      description: 'Drop your PO / receipt / invoice export from NetSuite, SAP, QuickBooks, Coupa, Ariba, etc.',
      required: true,
    },
    {
      key: 'contracts',
      label: 'SLAs / contract terms (optional)',
      extensions: ['.pdf', '.csv', '.xlsx', '.xls'],
      maxSizeMB: 5,
      maxFiles: 3,
      description: 'Drop contract terms or SLA sheet to override default thresholds for specific vendors.',
      required: false,
    },
  ],

  // The wizard collects KPI thresholds and produces a structured
  // rubric, which is passed as `context`. The label/placeholder here
  // is what the (rare) free-text-fallback box would show.
  contextInput: {
    label: 'Your evaluation rubric',
    placeholder: '',
    helpText: 'Walk through the rubric wizard above to set this.',
    required: true,
  },

  gate: {
    message:
      '{remaining} more vendors scored with grades, chronic flags, and recommended actions. Drop your email for the full quarterly review.',
    ctaText: 'Unlock Full Review',
    fields: [
      { name: 'email', type: 'email', label: 'Work email', required: true },
      {
        name: 'companySize',
        type: 'select',
        label: 'Company size',
        required: false,
        options: ['1-10', '11-50', '51-200', '201-1000', '1000+'],
      },
      {
        name: 'vendorCount',
        type: 'select',
        label: 'Active vendor count',
        required: false,
        options: ['< 25', '25-100', '100-500', '500-2000', '2000+'],
      },
    ],
  },

  llm: {
    model: 'claude-haiku-4-5',
    // Aggregating across N vendors + a few tool calls for research +
    // final answer. 30 is comfortable headroom for a 100-vendor file.
    maxTurns: 30,
  },

  systemPrompt: SYSTEM_PROMPT,
  buildUserPrompt({ files, context }) {
    const transactions = files.transactions?.[0];
    if (!transactions) {
      throw new Error(
        'Vendor Evaluator expected a file in the `transactions` slot',
      );
    }
    if (!context.trim()) {
      throw new Error(
        'Vendor Evaluator expected a rubric in `context` — walk through the wizard first.',
      );
    }

    // Transactions can be a big CSV — keep the cap conservative so
    // we don't blow the context window. 14k chars ≈ 3.5k tokens
    // which leaves plenty for reasoning + structured output.
    const txBody = truncateForModel(transactions.text, 14_000);
    const meta =
      'pageCount' in transactions.metadata
        ? `(${transactions.metadata.pageCount} pages)`
        : 'rowCount' in transactions.metadata
          ? `(${transactions.metadata.rowCount} rows)`
          : '';

    const contractFiles = files.contracts ?? [];
    const contractsBlock = contractFiles.length
      ? contractFiles
          .map((f: ParsedInput) => {
            const body = truncateForModel(f.text, 4_000);
            const m =
              'pageCount' in f.metadata
                ? `(${f.metadata.pageCount} pages)`
                : 'rowCount' in f.metadata
                  ? `(${f.metadata.rowCount} rows)`
                  : '';
            return `[FILE: ${f.filename}] ${m}\n${body}`;
          })
          .join('\n\n---\n\n')
      : '(no contract terms uploaded — use the rubric thresholds as defaults for all vendors)';

    return `EVALUATION RUBRIC (apply strictly):
${context.trim()}

---

VENDOR TRANSACTIONS (file: ${transactions.filename}, ${meta}):
${txBody}

---

CONTRACT TERMS / SLAs (per-vendor overrides):
${contractsBlock}`;
  },

  mcpServer: vendorMcpServer,
  allowedTools: [
    'mcp__agent__brave_search',
    'mcp__agent__search_web',
    'mcp__agent__fetch_webpage',
  ],
  outputSchema: OUTPUT_SCHEMA as unknown as Record<string, unknown>,

  teaser(result) {
    const TEASER_COUNT = 3;
    const vendors = result.vendors ?? [];
    // Sort by chronic-first, then NEEDS_REVIEW, then descending score
    // so the teaser shows the most action-worthy entries up top — not
    // a random slice. Visitors want to see the problems they're paying
    // to unlock, not the obvious EXCELLENT vendors.
    const sorted = [...vendors].sort((a, b) => {
      const gradeRank: Record<string, number> = {
        CHRONIC_UNDERPERFORMER: 0,
        NEEDS_REVIEW: 1,
        GOOD: 2,
        EXCELLENT: 3,
      };
      const ra = gradeRank[a.grade] ?? 4;
      const rb = gradeRank[b.grade] ?? 4;
      if (ra !== rb) return ra - rb;
      return (b.compositeScore ?? 0) - (a.compositeScore ?? 0);
    });
    const shown = sorted.slice(0, TEASER_COUNT);
    const remaining = Math.max(0, sorted.length - shown.length);
    return {
      teaser: { ...result, vendors: shown },
      remaining,
      gated: remaining > 0,
    };
  },
};

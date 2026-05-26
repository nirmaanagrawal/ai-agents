/**
 * Invoice Auditor — Level 4 (Autonomous Agent).
 *
 * What makes this Level 4 (vs Level 3 workflow):
 *   - Agent restates the goal + emits a PLAN before acting
 *     (visible to the visitor as `agentPlan` in the output).
 *   - Per-decision CONFIDENCE score; low-confidence cases get
 *     flagged for human review even when the rule-driven decision
 *     says auto-approve.
 *   - SELF-REVIEW: at the end, agent re-reads its own decisions
 *     and writes `selfReviewNotes` flagging anything it would
 *     change with more data.
 *   - DRAFTS the actions, not just the decisions: per-invoice
 *     approval-request emails (for managers/CFO) + vendor-dispute
 *     outreach (for rejects + duplicates). An AP clerk pastes
 *     these into NetSuite/SAP/email rather than writing from
 *     scratch — closing the loop on "route for approval all
 *     within current accounting tool".
 *   - BATCH-LEVEL PATTERN DETECTION: agent identifies vendor-
 *     level chronic issues, policy recommendations, and
 *     escalations that warrant leadership attention beyond the
 *     standard routing policy.
 *   - SELF-DIRECTED tool use: the agent decides when to call
 *     convertCurrency (mandatory for cross-currency), searchWeb
 *     (sanity check), and braveSearch (vendor news / recent
 *     events that affect risk).
 *
 * Tool set:
 *   convert_currency / search_web / fetch_webpage / brave_search.
 *   Same MCP server pattern as other agents.
 */
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { braveSearchTool } from '@/lib/agent-tools/brave-search';
import { convertCurrencyTool } from '@/lib/agent-tools/convert-currency';
import { fetchWebpageTool } from '@/lib/agent-tools/fetch-webpage';
import { searchWebTool } from '@/lib/agent-tools/search-web';
import { truncateForModel } from '@/lib/parse-file';
import type { AgentConfig, ParsedInput } from './types';

interface InvoiceAuditEntry {
  invoiceNumber: string;
  vendor: string;
  amount: number;
  currency?: string;
  poNumber: string | null;
  matchStatus: 'EXACT' | 'WITHIN_TOLERANCE' | 'VARIANCE' | 'NO_PO' | 'DUPLICATE';
  discrepancies: string[];
  decision: 'AUTO_APPROVE' | 'ROUTE_TO_MANAGER' | 'ROUTE_TO_CFO' | 'REJECT';
  /** 0-100. <70 means the agent isn't sure even after applying the
   *  policy — a human should sanity-check. */
  confidence: number;
  reasoning: string;
  suggestedAction: string;
  /** Draft email body the AP clerk pastes into their approval
   *  workflow / outbound vendor email. Always present — even
   *  AUTO_APPROVE invoices get a brief notification draft. */
  approvalDraft: string;
  /** Draft vendor outreach for REJECT / DUPLICATE / VARIANCE cases.
   *  Empty string when no outreach is needed. */
  vendorOutreachDraft: string;
}

interface VendorPattern {
  vendor: string;
  pattern: string;
  affectedInvoices: number;
  recommendedAction: string;
}

interface Escalation {
  invoiceNumber: string;
  vendor: string;
  reason: string;
  escalateTo: string;
}

export interface InvoiceAuditorOutput {
  agentPlan: string;
  totalInvoices: number;
  autoApproveCount: number;
  needsReviewCount: number;
  rejectedCount: number;
  totalValueUSD: number;
  potentialSavingsUSD: number;
  lowConfidenceCount: number;
  invoices: InvoiceAuditEntry[];
  vendorPatterns: VendorPattern[];
  policyRecommendations: string[];
  escalations: Escalation[];
  selfReviewNotes: string;
}

const SYSTEM_PROMPT = `You are an AUTONOMOUS accounts-payable audit
agent. You don't just classify invoices — you plan, execute, draft
the resulting actions, monitor your own confidence, and self-review
before submitting.

GOAL
  Process a batch of invoices against the visitor's approval policy
  + matching POs. For each invoice produce: a decision, draft the
  emails needed to act on it, and flag anything that needs human
  attention beyond the standard policy.

PHASE 1 — PLAN (do this before any tool call)
  Read the policy, the POs, and skim the invoices. In ≤4 sentences
  in \`agentPlan\`, state:
    • How many invoices and what currencies / vendors are in scope
    • Which invoices look risky (cross-currency, no PO, possible
      duplicates, large amounts)
    • Your sequencing — what you'll process first
  This block is visible to the visitor; it's not just a private
  thought. Treat it like a status update to the AP manager.

PHASE 2 — EXECUTE (per invoice)
  1. Extract invoiceNumber, vendor, amount, currency, PO reference.
  2. Match to a PO (exact match → fuzzy by vendor + nearest amount
     ±20% window).
  3. If currencies differ, ALWAYS call convert_currency before
     comparing. Never estimate FX from memory.
  4. Detect duplicates: same (invoiceNumber, vendor) appearing
     twice in this batch.
  5. Apply the policy STRICTLY for the decision. Never auto-approve
     on VARIANCE / DUPLICATE / NO_PO unless the policy explicitly
     says so.
  6. Score your CONFIDENCE 0-100. <70 means the decision is
     defensible by the rules but a human should sanity-check (e.g.,
     unfamiliar vendor, partial PO match, unusual amount for the
     vendor). Drive the confidence down on:
       - ambiguous PO matches
       - vendors with no prior history in this batch
       - cross-currency conversions with weak rate data
       - line items you couldn't fully verify
  7. Draft an APPROVAL EMAIL (\`approvalDraft\`):
       - AUTO_APPROVE: 1-2 line notification ("Approved for
         payment — matches PO-XXX exactly, within tolerance.")
       - ROUTE_TO_MANAGER / ROUTE_TO_CFO: 3-5 line approval
         request stating the variance, the suggested decision,
         and key numbers.
       - REJECT: 2-3 line internal note explaining why.
  8. For REJECT / DUPLICATE / large VARIANCE: also draft a
     VENDOR OUTREACH email (\`vendorOutreachDraft\`) the AP team
     can paste verbatim. Be professional, cite the specific
     numbers, request a credit note / explanation / corrected
     invoice as appropriate.

TOOLS YOU MAY USE
  • convert_currency(amount, from, to): live FX. MANDATORY for any
    cross-currency comparison.
  • search_web(query) / brave_search(query): vendor lookups for
    risk context (e.g., recent layoffs, M&A, lawsuits that change
    vendor reliability). Use SPARINGLY — only when context would
    change your confidence or decision.
  • fetch_webpage(url): pull a vendor's About / contact page when
    drafting outreach and you need a specific contact detail or
    company tone reference.

  Research budget: 8 tool calls max across the whole batch. Spend
  them on the highest-risk invoices and the largest-amount
  variances. Skip tool calls entirely for clean EXACT matches.

PHASE 3 — BATCH-LEVEL ANALYSIS
  After all invoices are decided, look ACROSS the batch:
    • \`vendorPatterns\`: same vendor with multiple issues
      ("Acme has 3 overcharges totaling $1,250 this batch"). Up to
      5 entries.
    • \`policyRecommendations\`: 0-4 short bullets if the data
      reveals the visitor's policy could be tightened ("Consider
      raising tolerance to 5% for vendor category X — current 2%
      triggers many false flags").
    • \`escalations\`: invoices that need leadership beyond the
      standard route (suspected fraud, repeated underperformance,
      legal/regulatory red flags). 0-5 entries.

PHASE 4 — SELF-REVIEW
  After every other field is filled, re-read your output. In
  \`selfReviewNotes\` (2-3 sentences):
    • Note any decisions you'd change with more data
    • Flag any low-confidence calls worth a second look
    • Note what's missing (e.g., "Policy is silent on FX-fee
      tolerance — assumed 1% buffer")

ACCURACY RULES
  • Never invent invoices or PO numbers. Missing field = null /
    empty, never a guess.
  • \`reasoning\` cites real numbers ("inv €1,000 = $1,080 @ 1.08
    vs PO $1,050 = +2.9%, within 3% tolerance").
  • Drafts are paste-ready: no [TODO], no template placeholders
    like [VENDOR NAME] — fill them in. Sign emails as "Accounts
    Payable Team" unless the policy says otherwise.
  • Set totalInvoices / autoApproveCount / needsReviewCount /
    rejectedCount / lowConfidenceCount to exactly match the
    returned array.
  • If the policy is empty, fall back to: 2% tolerance,
    auto-approve under $1,000 with EXACT match, manager
    otherwise. Mention this assumption in selfReviewNotes.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'agentPlan',
    'totalInvoices',
    'autoApproveCount',
    'needsReviewCount',
    'rejectedCount',
    'totalValueUSD',
    'potentialSavingsUSD',
    'lowConfidenceCount',
    'invoices',
    'vendorPatterns',
    'policyRecommendations',
    'escalations',
    'selfReviewNotes',
  ],
  properties: {
    agentPlan: { type: 'string', maxLength: 800 },
    totalInvoices: { type: 'integer' },
    autoApproveCount: { type: 'integer' },
    needsReviewCount: { type: 'integer' },
    rejectedCount: { type: 'integer' },
    totalValueUSD: { type: 'number' },
    potentialSavingsUSD: { type: 'number' },
    lowConfidenceCount: { type: 'integer' },
    selfReviewNotes: { type: 'string', maxLength: 600 },
    invoices: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'invoiceNumber',
          'vendor',
          'amount',
          'matchStatus',
          'discrepancies',
          'decision',
          'confidence',
          'reasoning',
          'suggestedAction',
          'approvalDraft',
          'vendorOutreachDraft',
        ],
        properties: {
          invoiceNumber: { type: 'string' },
          vendor: { type: 'string' },
          amount: { type: 'number' },
          currency: { type: 'string' },
          poNumber: { type: ['string', 'null'] },
          matchStatus: {
            type: 'string',
            enum: ['EXACT', 'WITHIN_TOLERANCE', 'VARIANCE', 'NO_PO', 'DUPLICATE'],
          },
          discrepancies: { type: 'array', items: { type: 'string', maxLength: 200 } },
          decision: {
            type: 'string',
            enum: ['AUTO_APPROVE', 'ROUTE_TO_MANAGER', 'ROUTE_TO_CFO', 'REJECT'],
          },
          confidence: { type: 'integer', minimum: 0, maximum: 100 },
          reasoning: { type: 'string', maxLength: 360 },
          suggestedAction: { type: 'string', maxLength: 280 },
          approvalDraft: { type: 'string', maxLength: 800 },
          vendorOutreachDraft: { type: 'string', maxLength: 1000 },
        },
      },
    },
    vendorPatterns: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['vendor', 'pattern', 'affectedInvoices', 'recommendedAction'],
        properties: {
          vendor: { type: 'string', maxLength: 200 },
          pattern: { type: 'string', maxLength: 280 },
          affectedInvoices: { type: 'integer' },
          recommendedAction: { type: 'string', maxLength: 280 },
        },
      },
    },
    policyRecommendations: {
      type: 'array',
      maxItems: 4,
      items: { type: 'string', maxLength: 320 },
    },
    escalations: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['invoiceNumber', 'vendor', 'reason', 'escalateTo'],
        properties: {
          invoiceNumber: { type: 'string', maxLength: 80 },
          vendor: { type: 'string', maxLength: 200 },
          reason: { type: 'string', maxLength: 320 },
          escalateTo: { type: 'string', maxLength: 80 },
        },
      },
    },
  },
} as const;

const auditMcpServer = createSdkMcpServer({
  name: 'audit',
  version: '2.0.0',
  tools: [convertCurrencyTool, searchWebTool, fetchWebpageTool, braveSearchTool],
});

export const invoiceAuditor: AgentConfig<InvoiceAuditorOutput> = {
  slug: 'invoice-auditor',
  name: 'Invoice Auditor',
  description:
    'Autonomous AP agent. Matches invoices to POs, applies your policy, drafts approval emails + vendor outreach, flags chronic patterns, and self-reviews before submitting.',
  icon: '🧾',
  category: 'finance',

  fileSlots: [
    {
      key: 'invoices',
      label: 'Invoices',
      extensions: ['.pdf', '.csv', '.xlsx', '.xls'],
      maxSizeMB: 10,
      maxFiles: 5,
      description: 'Drop invoice PDFs or a batch export (CSV / Excel)',
      required: true,
    },
    {
      key: 'pos',
      label: 'Purchase Orders',
      extensions: ['.csv', '.xlsx', '.xls'],
      maxSizeMB: 5,
      maxFiles: 1,
      description: 'Drop your PO reference sheet',
      required: true,
    },
  ],

  contextInput: {
    label: 'Your approval policy',
    placeholder:
      'e.g., Match tolerance ±3% on unit price, ±5% on total. ' +
      'Auto-approve under $5k with exact match. $5k-$25k → manager. ' +
      '>$25k → CFO. Flag duplicate invoice# + vendor in last 90 days.',
    helpText:
      'Describe your tolerances, approval thresholds, and routing rules. The more specific, the sharper the audit. Required.',
    required: true,
  },

  gate: {
    message:
      '{remaining} more invoices audited with approval drafts, vendor outreach, pattern alerts, and escalations ready to paste. Drop your email for the full review.',
    ctaText: 'Unlock Full Audit',
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
        name: 'apVolume',
        type: 'select',
        label: 'Monthly invoice volume',
        required: false,
        options: ['<100', '100-500', '500-2000', '2000+'],
      },
    ],
  },

  llm: {
    model: 'claude-haiku-4-5',
    // Bumped from 25 → 35 to give the agent room for: plan turn,
    // per-invoice processing (extract → match → maybe-FX → decide
    // → draft email × 2), batch-level analysis, self-review.
    // A 5-invoice batch with 2 cross-currency runs hits ~30 turns.
    maxTurns: 35,
  },

  systemPrompt: SYSTEM_PROMPT,
  buildUserPrompt({ files, context }) {
    const invoiceFiles = files.invoices ?? [];
    const poFile = files.pos?.[0];
    if (invoiceFiles.length === 0 || !poFile) {
      throw new Error('Invoice Auditor expected files in `invoices` and `pos` slots');
    }
    const poBlock = truncateForModel(poFile.text, 8_000);
    const invoicesBlock = invoiceFiles
      .map((f: ParsedInput) => {
        const body = truncateForModel(f.text, 6_000);
        const meta =
          'pageCount' in f.metadata
            ? `(${f.metadata.pageCount} pages)`
            : 'rowCount' in f.metadata
              ? `(${f.metadata.rowCount} rows)`
              : '';
        return `[FILE: ${f.filename}] ${meta}\n${body}`;
      })
      .join('\n\n---\n\n');

    return `APPROVAL POLICY (apply strictly):
${context.trim() || '(no policy provided — fall back to conservative defaults: 2% tolerance, auto-approve under $1k with EXACT match, manager otherwise)'}

---

OPEN PURCHASE ORDERS (file: ${poFile.filename}, ${poFile.metadata.rowCount ?? '?'} rows):
${poBlock}

---

INVOICES TO AUDIT (${invoiceFiles.length} file${invoiceFiles.length === 1 ? '' : 's'}):

${invoicesBlock}`;
  },

  mcpServer: auditMcpServer,
  allowedTools: [
    'mcp__agent__convert_currency',
    'mcp__agent__search_web',
    'mcp__agent__fetch_webpage',
    'mcp__agent__brave_search',
  ],
  outputSchema: OUTPUT_SCHEMA as unknown as Record<string, unknown>,

  teaser(result) {
    const TEASER_COUNT = 3;
    const invoices = result.invoices ?? [];
    // Teaser strategy: same logic as Vendor Evaluator — surface
    // REJECT and ROUTE_TO_CFO cases first, then ROUTE_TO_MANAGER,
    // then AUTO_APPROVE. Visitors want to see the problems they're
    // paying to unlock, not the clean approvals.
    const sorted = [...invoices].sort((a, b) => {
      const rank: Record<string, number> = {
        REJECT: 0,
        ROUTE_TO_CFO: 1,
        ROUTE_TO_MANAGER: 2,
        AUTO_APPROVE: 3,
      };
      const ra = rank[a.decision] ?? 4;
      const rb = rank[b.decision] ?? 4;
      if (ra !== rb) return ra - rb;
      return (b.amount ?? 0) - (a.amount ?? 0);
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

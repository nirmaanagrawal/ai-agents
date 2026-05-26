/**
 * Sales Proposal Writer — Level 4 (Autonomous).
 *
 * Visitor uploads:
 *   1. Prospect brief — discovery notes / RFP / intake email (PDF/DOCX/TXT)
 *   2. Their service/product catalog with pricing tiers + case studies
 *      (PDF/DOCX/CSV/XLSX)
 * …and answers an 8-MCQ wizard that locks in proposal shape (type,
 * audience, pricing model, discount cap, tone, length, required
 * sections, differentiation angles).
 *
 * The agent then:
 *   1. Plans its drafting approach (agentPlan).
 *   2. Reads the brief — pulls out the prospect's stated needs,
 *      budget, timeline, decision criteria, named stakeholders.
 *   3. Mines the catalog for the matching offerings + correct pricing
 *      tier — never invents line items or rates.
 *   4. (Optional) Web-verifies the prospect's company so the opening
 *      reads like a human did the homework (recent funding, headcount
 *      band, recent product launches that hint at need).
 *   5. Drafts the proposal: title, exec summary, scope, pricing
 *      table, timeline, assumptions, risks, next steps, cover email.
 *   6. Estimates win probability + flags gaps to follow up + offers
 *      one alternative approach the rep can pitch as a fallback.
 *   7. Self-reviews: where it had to assume, what catalog items it
 *      couldn't price confidently, what's missing from the brief.
 *
 * Why Level 4:
 *   It doesn't stop at "here are some bullets." It produces a
 *   recipient-named, paste-ready proposal *and* a paste-ready cover
 *   email, scores its own win probability, surfaces follow-up gaps,
 *   and offers an alternative pitch — each visible in the schema so
 *   the UI surfaces the autonomy.
 */
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { braveSearchTool } from '@/lib/agent-tools/brave-search';
import { fetchWebpageTool } from '@/lib/agent-tools/fetch-webpage';
import { searchWebTool } from '@/lib/agent-tools/search-web';
import { truncateForModel } from '@/lib/parse-file';
import type { AgentConfig } from './types';

interface PricingLineItem {
  description: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  lineTotal?: number;
  notes?: string;
}

interface Milestone {
  name: string;
  durationWeeks?: number;
  deliverable?: string;
}

export interface SalesProposalOutput {
  agentPlan: string;
  proposalTitle: string;
  recipientName: string;
  recipientCompany: string;
  executiveSummary: string;
  problemUnderstanding: string;
  proposedScope: string[];
  pricingTable: PricingLineItem[];
  pricingTotal: number;
  pricingCurrency: string;
  pricingNotes: string;
  timeline: Milestone[];
  assumptions: string[];
  risks: Array<{ risk: string; mitigation: string }>;
  whyUs: string[];
  nextSteps: string[];
  coverEmail: string;
  estimatedWinProbability: number;
  confidence: number;
  gapsToFollowUp: string[];
  alternativeApproach: string;
  appliedDiscountPercent: number;
  appliedDiscountReason: string;
  selfReviewNotes: string;
}

const SYSTEM_PROMPT = `You are an AUTONOMOUS sales-proposal agent.
Your job: turn a prospect brief + the seller's catalog + the seller's
shape rubric into a paste-ready proposal *and* a paste-ready cover
email, then score your own win probability and flag gaps.

INPUTS YOU WILL RECEIVE
  • PROPOSAL SHAPE — an 8-question rubric the rep filled out
    (proposal type, audience, pricing model, discount cap, tone,
    length target, required sections, differentiation angles).
    Treat this as STRICT — do not change tone, skip required
    sections, exceed the length target, or exceed the discount cap.
  • PROSPECT BRIEF — discovery notes / RFP / inbound email.
    Contains the customer name, the stated need, often a budget
    hint, timeline, and named stakeholders.
  • CATALOG — the seller's offerings, list pricing, tiers, case
    studies. THIS is the source of truth for what you can sell and
    at what price. Never invent SKUs or rates.

PHASE 1 — PLAN (do this FIRST, before drafting)
  In ≤4 sentences in \`agentPlan\`, state:
    • The recipient + their named pain (1 line)
    • Which catalog offering(s) fit the brief
    • The shape decisions you'll honor (tone + length + sections)
    • Any tool calls you plan to make (web verify the prospect's
      company — typically 0-3 calls; skip entirely if the brief is
      rich enough already)
  Write like a status update to the rep, not internal monologue.

PHASE 2 — READ THE BRIEF
  Extract precisely:
    • recipientName: the named decision-maker (if not stated, use
      "the {Company} team")
    • recipientCompany: the prospect's company name
    • Stated need / pain points
    • Budget signal (if any)
    • Timeline / urgency
    • Named stakeholders, decision criteria, success metrics

PHASE 3 — MINE THE CATALOG
  Identify the SKU(s) / service line(s) that match the stated need.
  Pull EXACT pricing from the catalog. If the brief implies a
  volume / tier, apply the right tier — don't average.
  If you can't find a clean catalog match for part of the scope,
  list that item in \`gapsToFollowUp\` rather than inventing a price.

PHASE 4 — (OPTIONAL) VERIFY THE PROSPECT
  RESEARCH BUDGET: at most 5 tool calls total. Use only when:
    • The brief mentions the company name but no other context.
    • A specific claim (funding round, hiring spike, product
      launch) would let you open with "saw you just X, that's
      exactly why this fits".
  Skip entirely if the brief gives you enough to write a sharp
  proposal. Tool calls cost time — only fire them when the resulting
  copy will be visibly better.

PHASE 5 — DRAFT THE PROPOSAL
  Follow the visitor's rubric EXACTLY:
    • Only include the sections they checked. Do not add sections
      they didn't request.
    • Match the length target — a "1-page summary" should NOT have
      4 paragraphs of scope.
    • Match the tone — "Formal / corporate" reads very differently
      from "Conversational / warm" or "Bold / pointed".
    • Stay within the discount cap. If you apply one, fill
      \`appliedDiscountPercent\` and \`appliedDiscountReason\` so
      the rep can sanity-check.
    • Weave the chosen differentiation angles through the narrative
      — don't just slap them in a "Why us" list and call it done.

  Specifics per field:
    • proposalTitle: short, specific to the prospect.
      Bad: "Proposal for Acme". Good: "Acme × Beanbag: Q3
      Implementation + 12-mo support".
    • executiveSummary: 3-5 sentences. Headline outcome + price
      + timeline + one differentiation hook.
    • problemUnderstanding: 2-4 sentences mirroring the prospect's
      OWN language from the brief. Show you listened.
    • proposedScope: bulleted, action-led, specific to THIS brief.
      Not generic boilerplate.
    • pricingTable: itemized line items from the catalog. Each
      line: description, quantity, unit, unitPrice, lineTotal.
      pricingTotal = sum of lineTotals (after any discount).
    • timeline: 3-6 milestones with name + durationWeeks +
      deliverable. Match the prospect's timeline if stated.
    • assumptions: things you assumed because the brief was
      silent (team size, integration scope, data availability).
      Be explicit so the prospect can correct.
    • risks: 2-4 honest risks each paired with a mitigation. A
      proposal that pretends there are no risks reads naive.
    • whyUs: 2-4 bullets, each tying to a differentiation angle
      the rep chose. Specific to this opportunity.
    • nextSteps: 2-3 concrete actions the prospect can take, with
      who-owns-what and timing.
    • coverEmail: 5-8 sentences, paste-ready. Subject implied.
      References ONE specific detail from the brief (or web
      research) to prove it's not generic.

PHASE 6 — META + SELF-REVIEW
  • estimatedWinProbability 0-100. Be honest:
      - High (70+): strong fit, budget signal present, urgency clear
      - Mid (40-69): partial fit OR no budget signal OR no urgency
      - Low (<40): poor fit, competing for a slot, or brief is thin
  • confidence 0-100 in the proposal itself:
      - <70 means: catalog gaps, ambiguous brief, untested
        assumptions about scope
  • gapsToFollowUp: 2-5 specific questions the rep should ask
    before sending. These should be the things you had to assume.
  • alternativeApproach: 2-3 sentences describing a Plan B the rep
    can pitch if the prospect pushes back on price or scope
    (smaller pilot, phased rollout, different package). Always
    include one — it's a cheap insurance policy.
  • selfReviewNotes: 2-3 sentences naming what you assumed, what
    catalog items you couldn't price cleanly, and what would make
    this proposal materially stronger if the rep filled it in.

ACCOUNTING
  • pricingTotal MUST equal the sum of lineTotals after the discount
    has been applied.
  • pricingCurrency defaults to whatever the catalog shows (USD if
    silent).
  • Length: respect the rubric's length target — a 1-page summary
    means tight scope + minimal assumptions text, not a wall.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'agentPlan',
    'proposalTitle',
    'recipientName',
    'recipientCompany',
    'executiveSummary',
    'problemUnderstanding',
    'proposedScope',
    'pricingTable',
    'pricingTotal',
    'pricingCurrency',
    'pricingNotes',
    'timeline',
    'assumptions',
    'risks',
    'whyUs',
    'nextSteps',
    'coverEmail',
    'estimatedWinProbability',
    'confidence',
    'gapsToFollowUp',
    'alternativeApproach',
    'appliedDiscountPercent',
    'appliedDiscountReason',
    'selfReviewNotes',
  ],
  properties: {
    agentPlan: { type: 'string', maxLength: 800 },
    proposalTitle: { type: 'string', maxLength: 160 },
    recipientName: { type: 'string', maxLength: 120 },
    recipientCompany: { type: 'string', maxLength: 160 },
    executiveSummary: { type: 'string', maxLength: 900 },
    problemUnderstanding: { type: 'string', maxLength: 800 },
    proposedScope: {
      type: 'array',
      maxItems: 12,
      items: { type: 'string', maxLength: 320 },
    },
    pricingTable: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description'],
        properties: {
          description: { type: 'string', maxLength: 280 },
          quantity: { type: 'number' },
          unit: { type: 'string', maxLength: 40 },
          unitPrice: { type: 'number' },
          lineTotal: { type: 'number' },
          notes: { type: 'string', maxLength: 200 },
        },
      },
    },
    pricingTotal: { type: 'number' },
    pricingCurrency: { type: 'string', maxLength: 8 },
    pricingNotes: { type: 'string', maxLength: 400 },
    timeline: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string', maxLength: 120 },
          durationWeeks: { type: 'number' },
          deliverable: { type: 'string', maxLength: 280 },
        },
      },
    },
    assumptions: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string', maxLength: 280 },
    },
    risks: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['risk', 'mitigation'],
        properties: {
          risk: { type: 'string', maxLength: 240 },
          mitigation: { type: 'string', maxLength: 240 },
        },
      },
    },
    whyUs: {
      type: 'array',
      maxItems: 6,
      items: { type: 'string', maxLength: 280 },
    },
    nextSteps: {
      type: 'array',
      maxItems: 5,
      items: { type: 'string', maxLength: 240 },
    },
    coverEmail: { type: 'string', maxLength: 1400 },
    estimatedWinProbability: { type: 'integer', minimum: 0, maximum: 100 },
    confidence: { type: 'integer', minimum: 0, maximum: 100 },
    gapsToFollowUp: {
      type: 'array',
      maxItems: 6,
      items: { type: 'string', maxLength: 280 },
    },
    alternativeApproach: { type: 'string', maxLength: 600 },
    appliedDiscountPercent: { type: 'number', minimum: 0, maximum: 100 },
    appliedDiscountReason: { type: 'string', maxLength: 240 },
    selfReviewNotes: { type: 'string', maxLength: 600 },
  },
} as const;

const proposalMcpServer = createSdkMcpServer({
  name: 'proposal',
  version: '1.0.0',
  tools: [braveSearchTool, searchWebTool, fetchWebpageTool],
});

export const salesProposal: AgentConfig<SalesProposalOutput> = {
  slug: 'sales-proposal',
  name: 'Sales Proposal Writer',
  description:
    'Upload a prospect brief and your catalog. The agent reads both, drafts a paste-ready proposal + cover email tuned to your shape rubric, scores its own win probability, and flags the gaps you should ask about before sending.',
  icon: '📝',
  category: 'sales',

  fileSlots: [
    {
      key: 'brief',
      label: 'Prospect brief / discovery notes',
      extensions: ['.pdf', '.docx', '.txt', '.md'],
      maxSizeMB: 10,
      maxFiles: 1,
      description:
        'Discovery call notes, RFP, or inbound email. Whatever the prospect told you about their need, budget, timeline, and stakeholders.',
      required: true,
    },
    {
      key: 'catalog',
      label: 'Your catalog / pricing sheet',
      extensions: ['.pdf', '.docx', '.csv', '.xlsx', '.xls', '.txt', '.md'],
      maxSizeMB: 10,
      maxFiles: 1,
      description:
        'Your offerings + list pricing + tiers (and ideally a case study or two). The agent will quote line items only from what is in here.',
      required: true,
    },
  ],

  contextInput: {
    label: 'Proposal shape',
    placeholder: '',
    helpText: 'Walk through the 8-question wizard above to set this.',
    required: true,
  },

  gate: {
    message:
      'See the full proposal — every section, pricing table, paste-ready cover email, and the agent\'s win-probability call. Drop your email to unlock.',
    ctaText: 'Unlock Full Proposal',
    fields: [
      { name: 'email', type: 'email', label: 'Work email', required: true },
      {
        name: 'deal_size',
        type: 'select',
        label: 'Typical deal size',
        required: false,
        options: ['< $10K', '$10K – $50K', '$50K – $250K', '$250K – $1M', '$1M+'],
      },
      {
        name: 'sales_motion',
        type: 'select',
        label: 'Sales motion',
        required: false,
        options: ['Founder-led', 'AE + SDR', 'Enterprise / field sales', 'PLG + sales-assist'],
      },
    ],
  },

  llm: {
    model: 'claude-haiku-4-5',
    // Long-context single-shot proposal drafting + optional web
    // verification + self-review. 20 turns is plenty — most runs
    // settle in <8 turns with 0-3 tool calls.
    maxTurns: 20,
  },

  systemPrompt: SYSTEM_PROMPT,
  buildUserPrompt({ files, context }) {
    const brief = files.brief?.[0];
    const catalog = files.catalog?.[0];

    if (!brief) {
      throw new Error('Sales Proposal Writer expected a file in the `brief` slot');
    }
    if (!catalog) {
      throw new Error('Sales Proposal Writer expected a file in the `catalog` slot');
    }
    if (!context.trim()) {
      throw new Error(
        'Sales Proposal Writer expected a shape rubric in `context` — walk through the wizard first.',
      );
    }

    const briefBody = truncateForModel(brief.text, 8_000);
    const catalogBody = truncateForModel(catalog.text, 12_000);

    const metaOf = (f: typeof brief): string => {
      if ('pageCount' in f.metadata) return `(${f.metadata.pageCount} pages)`;
      if ('rowCount' in f.metadata) return `(${f.metadata.rowCount} rows)`;
      return '';
    };

    return `${context.trim()}

---

PROSPECT BRIEF (file: ${brief.filename} ${metaOf(brief)}):
${briefBody}

---

CATALOG / PRICING (file: ${catalog.filename} ${metaOf(catalog)}):
${catalogBody}`;
  },

  mcpServer: proposalMcpServer,
  allowedTools: [
    'mcp__agent__brave_search',
    'mcp__agent__search_web',
    'mcp__agent__fetch_webpage',
  ],
  outputSchema: OUTPUT_SCHEMA as unknown as Record<string, unknown>,

  teaser(result) {
    // Proposal is a single artifact, not a list of items. The teaser
    // shows enough to prove the agent did real work (title, recipient,
    // exec summary, plan, first 1-2 scope bullets, win probability)
    // and gates the meaty bits (pricing table, full scope, cover
    // email, risks, next steps, self-review).
    const scope = Array.isArray(result.proposedScope) ? result.proposedScope : [];
    const teasedScope = scope.slice(0, 2);
    const hiddenScope = Math.max(0, scope.length - teasedScope.length);

    const remaining =
      hiddenScope +
      (Array.isArray(result.pricingTable) ? result.pricingTable.length : 0) +
      (result.coverEmail ? 1 : 0) +
      (Array.isArray(result.risks) ? result.risks.length : 0) +
      (Array.isArray(result.nextSteps) ? result.nextSteps.length : 0);

    return {
      teaser: {
        agentPlan: result.agentPlan,
        proposalTitle: result.proposalTitle,
        recipientName: result.recipientName,
        recipientCompany: result.recipientCompany,
        executiveSummary: result.executiveSummary,
        problemUnderstanding: result.problemUnderstanding,
        proposedScope: teasedScope,
        // Show a single redacted line so the visitor can see a table
        // exists; rest unlocks behind the gate.
        pricingTable: [],
        pricingTotal: 0,
        pricingCurrency: result.pricingCurrency,
        timeline: [],
        assumptions: [],
        risks: [],
        whyUs: Array.isArray(result.whyUs) ? result.whyUs.slice(0, 1) : [],
        nextSteps: [],
        coverEmail: '',
        estimatedWinProbability: result.estimatedWinProbability,
        confidence: result.confidence,
        gapsToFollowUp: [],
        alternativeApproach: '',
        appliedDiscountPercent: result.appliedDiscountPercent,
        appliedDiscountReason: '',
        selfReviewNotes: '',
      },
      remaining,
      gated: remaining > 0,
    };
  },
};

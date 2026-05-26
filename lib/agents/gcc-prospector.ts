/**
 * GCC Prospector — Level 4 (Autonomous Agent).
 *
 * What makes this Level 4 (vs Level 3 workflow):
 *   - Agent restates the goal + emits an explicit SEARCH PLAN
 *     before any tool call (visible to user as `agentPlan`).
 *   - Per-prospect CONFIDENCE score reflecting how thoroughly each
 *     prospect was verified. Low-confidence prospects get flagged.
 *   - DRAFTS the first-touch OUTREACH per prospect — a paste-ready
 *     email that cites specific signals from THAT company, not a
 *     template.
 *   - FOLLOW-UP RESEARCH per prospect — what the AE / SDR should
 *     verify or look up before reaching out (the agent admits what
 *     it couldn't confirm).
 *   - BATCH-LEVEL INSIGHTS — patterns across the prospect set
 *     (5/10 had recent Series B's → this is a good outbound window).
 *   - SELF-REVIEW at the end — gaps in coverage, assumptions made,
 *     what to refine next run.
 *
 * Unlike Invoice Auditor (which acts on a fixed input list), this
 * agent does autonomous discovery: it decides what to search for,
 * what counts as a real candidate, when to verify deeper, and when
 * to discard. Tools fan out as needed across the run.
 */
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { braveSearchTool } from '@/lib/agent-tools/brave-search';
import { checkIndiaHiringTool } from '@/lib/agent-tools/check-india-hiring';
import { fetchWebpageTool } from '@/lib/agent-tools/fetch-webpage';
import { searchWebTool } from '@/lib/agent-tools/search-web';
import type { AgentConfig } from './types';

interface ProspectOut {
  companyName: string;
  hqCountry: string;
  hqCity?: string;
  parentWebsite: string;
  industry: string;
  fundingStage: string;
  globalHeadcount?: string;
  indiaPresence: {
    cities: string[];
    estimatedTeamSize: string;
    openEngineeringRoles: number;
    sampleRolesPosted: string[];
  };
  fitGrade: 'HOT' | 'WARM' | 'COLD';
  fitScore: number;
  /** 0-100: how thoroughly was this prospect verified? <70 = data
   *  is thin / signals indirect; the AE should sanity-check. */
  confidence: number;
  signals: string[];
  underTheRadar: boolean;
  careersUrl?: string;
  reasoning: string;
  /** Paste-ready first-touch outreach email body. Cites at least
   *  one specific signal from THIS company. */
  outreachDraft: string;
  /** What the AE / SDR should verify before sending the outreach.
   *  Examples: "Confirm the India office is still in Bangalore
   *  (their careers page didn't list a city)" / "Check if the
   *  India site lead has changed since the announcement". */
  followUpResearch: string[];
}

export interface GccProspectorOutput {
  agentPlan: string;
  totalProspects: number;
  hotCount: number;
  warmCount: number;
  coldCount: number;
  lowConfidenceCount: number;
  searchSummary: string;
  prospects: ProspectOut[];
  crossBatchInsights: string[];
  selfReviewNotes: string;
}

const SYSTEM_PROMPT = `You are an AUTONOMOUS GCC (Global Capability
Center) prospect-discovery agent for Beanbag AI, an India-based
talent partner. You don't just return a list — you plan your search,
verify each prospect, draft the outreach, flag your confidence, and
self-review before submitting.

GOAL
  Given the visitor's structured GCC PROSPECT PROFILE, DISCOVER ~10
  real companies that match it. Verify India presence. Draft the
  first-touch outreach for each. Flag gaps for the AE to follow up.

CRITICAL POSITIONING — UNDER-THE-RADAR
  Most lists of "top GCCs in India" surface the obvious ones:
  Google, Microsoft, Amazon, Meta, Walmart Labs, etc. Saturated with
  vendor outreach. If the visitor's profile asks for under-the-radar
  (almost always the case), you MUST:
    • Avoid queries like "top GCCs in India" / "best GCCs" / lists
    • Bias toward queries that hit individual companies' careers
      pages, LinkedIn engineering posts, hiring announcements
    • Skip any prospect whose name is in the visitor's exclusion list
    • Skip Indian IT-services firms (TCS, Infosys, Wipro, HCL, etc.)
      and BPOs — they're not GCCs

PHASE 1 — PLAN (do this BEFORE any tool call)
  In ≤4 sentences in \`agentPlan\`, state:
    • Your search strategy (e.g., "Will use brave_search with
      site:careers.{domain} for Series B SaaS US-HQ + Bangalore
      filters, then verify with check_india_hiring on each candidate")
    • Which dimensions of the profile you'll lean on hardest
    • Roughly how you'll spend the research budget
  This is visible to the visitor — write it like a status update to
  a sales team lead.

PHASE 2 — DISCOVER (per prospect, ~10 prospects total)
  Per prospect, run this loop:
    1. brave_search 1-2 broad queries combining HQ country + funding
       stage + India city + role type. Look for candidate company
       names in the results.
    2. For each candidate, brave_search "{company} india engineering"
       to find their careers presence.
    3. check_india_hiring on the candidate's domain — this is the
       verification gate. Need at least 1 India-located eng role
       found (ideally 3+) to count it as a real GCC.
    4. fetch_webpage on the company's About / India page if you need
       context for the outreach (their tagline, their values, what
       they do).
    5. Include if verified, discard if not.
  STOP at ~10 verified prospects (the default; visitor profile may
  override).

PHASE 3 — DRAFT OUTREACH (per prospect)
  Write a 3-5 sentence first-touch email body in \`outreachDraft\`:
    • Reference at least ONE specific signal from THIS company
      (recent funding, the role you saw posted, the city expansion)
    • State the relevance — Beanbag = pre-vetted senior engineers
      in India, in 2-3 weeks
    • Pose a low-friction ask (15-min call / share a sample profile)
    • Be human, not template-y. Read it back — would you reply?

PHASE 4 — CONFIDENCE + FOLLOW-UPS (per prospect)
  Score \`confidence\` 0-100. <70 means:
    - Indirect signals (e.g., LinkedIn says "Bangalore" but no
      careers-page listing)
    - Headcount is your guess (no public number)
    - Recent announcement is older than 6 months
  In \`followUpResearch\` (1-3 short items), name what the AE
  should verify before sending the outreach. Be specific:
    ✗ "Verify India presence"
    ✓ "Confirm engineering office is still in Bangalore (their
       careers page listed Hyderabad too — unclear which is HQ)"

PHASE 5 — BATCH-LEVEL INSIGHTS
  After all prospects are processed, look ACROSS the batch.
  In \`crossBatchInsights\` (1-4 short bullets), state any
  pattern that would help the AE plan their outreach:
    • "6 of 10 are Series B — Series-B-stage SaaS is a hot
      moment for outbound right now"
    • "All 10 are concentrated in Bangalore — opportunity to
      schedule an in-person GCC tour week"
    • "3 prospects (X, Y, Z) all use the same recruiting agency
      according to LinkedIn — competitor mention worth knowing"

PHASE 6 — SELF-REVIEW
  In \`selfReviewNotes\` (2-3 sentences):
    • What data was thin across this run (e.g., "DDG had no
      abstract for 6/10 — relied on careers-page text only")
    • Any prospects you'd reconsider with one more search
    • Assumptions you made about the profile that the visitor
      should sanity-check ("Assumed 'Anywhere in India' means
      tier-1 cities; skipped Indore / Coimbatore")

ACCOUNTING
  • totalProspects / hotCount / warmCount / coldCount /
    lowConfidenceCount must exactly match the returned array.
  • Don't include COLD prospects unless visitor explicitly asked
    for a wide net.
  • Never fabricate companies. If verification fails, discard.

TOOLS
  • brave_search: discovery workhorse. Real SERP results.
  • check_india_hiring: the verification gate. Use on every
    candidate before including.
  • fetch_webpage: for About / careers pages when you need
    outreach context.
  • search_web: DDG fallback for KNOWN-brand companies.

  Research budget: 4-6 tool calls per prospect × ~10 prospects ≈
  40-60 tool calls total. Stop when you have your prospects.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'agentPlan',
    'totalProspects',
    'hotCount',
    'warmCount',
    'coldCount',
    'lowConfidenceCount',
    'searchSummary',
    'prospects',
    'crossBatchInsights',
    'selfReviewNotes',
  ],
  properties: {
    agentPlan: { type: 'string', maxLength: 800 },
    totalProspects: { type: 'integer' },
    hotCount: { type: 'integer' },
    warmCount: { type: 'integer' },
    coldCount: { type: 'integer' },
    lowConfidenceCount: { type: 'integer' },
    searchSummary: { type: 'string', maxLength: 600 },
    selfReviewNotes: { type: 'string', maxLength: 600 },
    crossBatchInsights: {
      type: 'array',
      maxItems: 4,
      items: { type: 'string', maxLength: 280 },
    },
    prospects: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'companyName',
          'hqCountry',
          'parentWebsite',
          'industry',
          'fundingStage',
          'indiaPresence',
          'fitGrade',
          'fitScore',
          'confidence',
          'signals',
          'underTheRadar',
          'reasoning',
          'outreachDraft',
          'followUpResearch',
        ],
        properties: {
          companyName: { type: 'string', maxLength: 120 },
          hqCountry: { type: 'string', maxLength: 60 },
          hqCity: { type: 'string', maxLength: 60 },
          parentWebsite: { type: 'string', maxLength: 200 },
          industry: { type: 'string', maxLength: 80 },
          fundingStage: { type: 'string', maxLength: 60 },
          globalHeadcount: { type: 'string', maxLength: 40 },
          indiaPresence: {
            type: 'object',
            additionalProperties: false,
            required: [
              'cities',
              'estimatedTeamSize',
              'openEngineeringRoles',
              'sampleRolesPosted',
            ],
            properties: {
              cities: { type: 'array', items: { type: 'string', maxLength: 40 } },
              estimatedTeamSize: { type: 'string', maxLength: 40 },
              openEngineeringRoles: { type: 'integer' },
              sampleRolesPosted: {
                type: 'array',
                items: { type: 'string', maxLength: 80 },
              },
            },
          },
          fitGrade: { type: 'string', enum: ['HOT', 'WARM', 'COLD'] },
          fitScore: { type: 'integer', minimum: 0, maximum: 100 },
          confidence: { type: 'integer', minimum: 0, maximum: 100 },
          signals: { type: 'array', items: { type: 'string', maxLength: 200 } },
          underTheRadar: { type: 'boolean' },
          careersUrl: { type: 'string', maxLength: 300 },
          reasoning: { type: 'string', maxLength: 320 },
          outreachDraft: { type: 'string', maxLength: 800 },
          followUpResearch: {
            type: 'array',
            maxItems: 4,
            items: { type: 'string', maxLength: 240 },
          },
        },
      },
    },
  },
} as const;

const prospectorMcpServer = createSdkMcpServer({
  name: 'prospector',
  version: '2.0.0',
  tools: [braveSearchTool, checkIndiaHiringTool, fetchWebpageTool, searchWebTool],
});

export const gccProspector: AgentConfig<GccProspectorOutput> = {
  slug: 'gcc-prospector',
  name: 'GCC Prospector',
  description:
    'Autonomous discovery agent. Finds under-the-radar GCCs hiring engineering talent in India, verifies their India presence, drafts paste-ready outreach, and flags what to follow up on.',
  icon: '🌏',
  category: 'sales',

  // Zero file slots — pure discovery from the wizard-built profile.
  fileSlots: [],

  contextInput: {
    label: 'GCC profile',
    placeholder: '',
    helpText: 'Walk through the 8-question wizard above to set this.',
    required: true,
  },

  gate: {
    message:
      '{remaining} more GCC prospects with India team signals, paste-ready outreach drafts, follow-up research, and confidence scores. Drop your email for the full list.',
    ctaText: 'Unlock Full Prospect List',
    fields: [
      { name: 'email', type: 'email', label: 'Work email', required: true },
      {
        name: 'companySize',
        type: 'select',
        label: 'Your company size',
        required: false,
        options: ['1-10', '11-50', '51-200', '201-1000', '1000+'],
      },
      {
        name: 'prospectVolume',
        type: 'select',
        label: 'Prospects per month you need',
        required: false,
        options: ['10-25', '25-100', '100-500', '500+'],
      },
    ],
  },

  llm: {
    model: 'claude-haiku-4-5',
    // 45 turns: planning + discovery loop (4-6 tools × 10 prospects)
    // + outreach drafting + batch insights + self-review. Slightly
    // higher than the old 40 to give the agent headroom for the
    // self-review pass.
    maxTurns: 45,
  },

  systemPrompt: SYSTEM_PROMPT,
  buildUserPrompt({ context }) {
    if (!context || !context.trim()) {
      throw new Error('GCC Prospector expected a wizard-built profile in `context`');
    }
    return `${context}

---

Now discover ~10 prospects matching this profile. Plan first (Phase 1), verify each one's India presence via check_india_hiring before including (Phase 2), draft outreach (Phase 3), score confidence + flag follow-ups (Phase 4), then write batch insights (Phase 5) and self-review (Phase 6). Use the under-the-radar bias as instructed above.`;
  },

  mcpServer: prospectorMcpServer,
  allowedTools: [
    'mcp__agent__brave_search',
    'mcp__agent__check_india_hiring',
    'mcp__agent__fetch_webpage',
    'mcp__agent__search_web',
  ],
  outputSchema: OUTPUT_SCHEMA as unknown as Record<string, unknown>,

  teaser(result) {
    const TEASER_COUNT = 3;
    const prospects = result.prospects ?? [];
    // Surface HOT first, then highest-score warm. Visitors should
    // see the most actionable prospects free; the long tail is what
    // they pay to unlock.
    const sorted = [...prospects].sort((a, b) => {
      const rank: Record<string, number> = { HOT: 0, WARM: 1, COLD: 2 };
      const ra = rank[a.fitGrade] ?? 3;
      const rb = rank[b.fitGrade] ?? 3;
      if (ra !== rb) return ra - rb;
      return (b.fitScore ?? 0) - (a.fitScore ?? 0);
    });
    const shown = sorted.slice(0, TEASER_COUNT);
    const remaining = Math.max(0, sorted.length - shown.length);
    return {
      teaser: { ...result, prospects: shown },
      remaining,
      gated: remaining > 0,
    };
  },
};

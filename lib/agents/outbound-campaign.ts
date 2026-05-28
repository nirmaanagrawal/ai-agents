/**
 * Outbound Campaign Builder — Level 4 (Autonomous).
 *
 * Visitor uploads:
 *   1. Persona / account list (CSV) — required. Per-row: name, title,
 *      company, optional intent signals (recent funding, hiring, etc.).
 *   2. Value-prop / product brief (PDF/DOCX) — required. The seller's
 *      pitch, customer logos, before/after numbers.
 * …and answers an 8-MCQ wizard that defines campaign shape (goal,
 * channels, length, tone arc, cadence, required angles, opt-out
 * behavior, hard don'ts).
 *
 * The agent then:
 *   1. Plans its approach (agentPlan).
 *   2. Mines the brief — extracts proof points, outcomes, social
 *      proof, the most concrete claim per audience tier.
 *   3. For each persona row:
 *      - matches their role + signals to the most relevant proof
 *        point in the brief,
 *      - drafts a full N-step sequence (subject + body + timing
 *        + channel per step) honoring the playbook's tone arc,
 *      - generates 2 A/B subject variants per email step,
 *      - validates every step against the hard-don'ts list,
 *      - scores confidence (how strong was the signal match).
 *   4. Surfaces cross-batch insights: which personas got the
 *      strongest angles, which segments to deprioritize, top-
 *      performing hooks across the batch.
 *   5. Names deliverability concerns (sender warm-up, link count,
 *      unsubscribe presence).
 *   6. Self-reviews: thin personas, weak signals, brief gaps that
 *      would sharpen v2.
 *
 * Why Level 4:
 *   The agent doesn't stop at "here's a generic template." It
 *   produces a paste-ready, signal-grounded sequence *per persona*,
 *   validates each step against compliance rules, scores its own
 *   confidence, surfaces cross-batch patterns, and admits where the
 *   brief was thin. Each is in the schema so the UI shows the
 *   autonomy directly.
 */
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { braveSearchTool } from '@/lib/agent-tools/brave-search';
import { fetchWebpageTool } from '@/lib/agent-tools/fetch-webpage';
import { searchWebTool } from '@/lib/agent-tools/search-web';
import { truncateForModel } from '@/lib/parse-file';
import type { AgentConfig } from './types';

interface SequenceStep {
  stepNumber: number;
  channel: 'email' | 'linkedin' | 'phone' | 'other';
  dayOffset: number;
  subject?: string;
  subjectVariant?: string;
  body: string;
  callToAction: string;
  notes?: string;
}

interface PersonaOut {
  personaName: string;
  jobTitle: string;
  company: string;
  segment: string;
  openingHook: string;
  matchedAngle: string;
  matchedProofPoint: string;
  sequence: SequenceStep[];
  confidence: number;
  isHighPriority: boolean;
  personalizationNotes: string[];
  reasoning: string;
  complianceFlags: string[];
}

export interface OutboundCampaignOutput {
  agentPlan: string;
  campaignTitle: string;
  executiveSummary: string;
  totalPersonas: number;
  highPriorityCount: number;
  totalSteps: number;
  segmentsCovered: string[];
  topPerformingAngles: string[];
  segmentsToDeprioritize: string[];
  deliverabilityTips: string[];
  personas: PersonaOut[];
  selfReviewNotes: string;
}

const SYSTEM_PROMPT = `You are an AUTONOMOUS outbound-sequence agent.
Your job: turn a target persona list + the seller's value-prop brief
+ a campaign playbook into a per-persona multi-step sequence — every
step subject + body + timing + channel filled in, validated against
the playbook's hard don'ts, scored for confidence.

INPUTS YOU WILL RECEIVE
  • CAMPAIGN PLAYBOOK — the 8-question rubric the rep filled out
    (goal, channels, sequence length, tone arc, cadence, required
    angles, opt-out behavior, hard don'ts). Treat this as STRICT —
    do not change channels, exceed length, skip required angles,
    or violate any don't.
  • PERSONA LIST (CSV) — per-row target. Maps loose column names
    sensibly (name / "First Name" / "Contact"; title / "Job Title" /
    "Position"; company / "Account" / "Org"; signals / "Notes" /
    "Intent" / "Recent News").
  • VALUE-PROP BRIEF — the seller's pitch, proof points, customer
    logos, before/after numbers. THIS is the source of truth for
    every claim. Never invent proof points or numbers that aren't
    in the brief.

PHASE 1 — PLAN (do this FIRST, before drafting)
  In ≤4 sentences in \`agentPlan\`, state:
    • How many personas you'll sequence + how you'll segment them
    • Which 2-3 angles from the brief look strongest for this list
    • How you'll honor the tone arc + cadence + length
    • Any tool calls you anticipate (typically 0-2, only when a
      persona row has a thin signal and you want to verify ONE
      thing about their company)
  Write like a status update to the AE, not internal monologue.

PHASE 2 — MINE THE BRIEF
  Extract before drafting:
    • 3-5 proof points (concrete claims with numbers — "cut hiring
      time 40% at Acme", "$2.3M ARR added in 6 months at Globex")
    • Customer logos / case studies
    • The seller's positioning + the buyer pain it solves
    • Hard claims that need verification (red-flag anything the
      brief itself flags as confidential)

PHASE 3 — PER PERSONA: SEQUENCE BUILD
  For each row in the persona list:

  • personaName / jobTitle / company / segment: pull from the row.
    Segment = your own grouping (e.g., "VP Eng at Series B SaaS",
    "Head of Talent at scale-up").

  • openingHook: 1-2 sentences referencing a SPECIFIC signal from
    the row (recent funding, hiring spike, named tech stack) OR
    from the title + company combo. If the row has no signal,
    open with an insight — never with "Hope you're well" or
    "Quick question" (those are in the don't list anyway).

  • matchedAngle: pick EXACTLY ONE from the playbook's required-
    angles list. Same persona segment can share an angle, but each
    persona's hook should still feel custom.

  • matchedProofPoint: pull EXACTLY ONE from the brief. The proof
    must be defensible — visitor will be on the hook if a prospect
    asks.

  • sequence: array of EXACTLY N steps where N matches the
    playbook's sequence length. For each step:
      - stepNumber (1-indexed)
      - channel: from the playbook's channel mix. Mix sensibly —
        if mix is "email + linkedin", alternate, don't bunch.
      - dayOffset: 0 for step 1, then spaced per the cadence
        (daily / 2-3d / weekly / mixed).
      - subject (for email/linkedin): under 60 chars, no caps lock,
        no emoji unless the brand calls for it. Specific, not
        generic ("Cut hiring time at {Company}", not "Quick chat").
      - subjectVariant (for email steps only): a second subject the
        rep can A/B against the primary. Should test a meaningfully
        different angle, not just word-swap.
      - body: 3-6 sentences for email, 2-3 for LinkedIn, bullet
        notes for phone. Tone matches the playbook's arc position
        (warm in step 1 if "build pressure" arc, direct by step 3).
      - callToAction: ONE clear ask, matched to the campaign goal.
        Don't ladder more aggressively in early steps than the
        playbook's arc says.
      - notes (optional): rep-facing note ("send 9am their time",
        "personalize the {{Industry}} placeholder").

  • confidence 0-100. <70 means:
      - thin row data (no signal, no title clarity)
      - generic angle match (couldn't tie to a specific proof point)
      - segment is unfamiliar to the brief's track record
  • isHighPriority: true if BOTH the row's signal is strong AND the
    brief has a tight proof point for this segment. Caps at ~30% of
    the list — don't flag everyone.
  • personalizationNotes: 1-3 short rep-facing notes ("verify the
    funding date before send", "they hired a CISO last month").
  • reasoning: 1-3 sentences citing the actual fields ("Maria is
    Head of Talent at a $4M-ARR Series A; brief's '40% time-to-fill
    reduction' proof maps directly").
  • complianceFlags: list any don't-violations you nearly hit but
    avoided. Empty array if clean. Example: "Trimmed second link
    in step 3 — playbook restricts to 1 per email."

PHASE 4 — VALIDATE EVERY STEP
  Walk back through each persona's sequence and check the playbook's
  hard don'ts. If a step violates:
    - Try to fix it (rewrite the offending line, remove the link)
    - If unfixable, note it in complianceFlags and lower confidence
  Don't ship a sequence with a known violation.

PHASE 5 — CROSS-BATCH INSIGHTS
  After all personas are done, look ACROSS the batch:
    • topPerformingAngles: 2-4 angles that landed the strongest
      proof matches across multiple personas
    • segmentsToDeprioritize: 1-3 segments where confidence was
      consistently low — visitor should drop these from the batch
      or re-source the data
    • deliverabilityTips: 2-3 ACTIONABLE concerns
      ("sender warm-up: 25 sends/day cap for the first week",
      "all sequences hit unsubscribe in footer per playbook",
      "step 3 emails are >150 words — consider trimming")

PHASE 6 — SELF-REVIEW
  selfReviewNotes (2-3 sentences):
    - Personas with <70 confidence the rep should re-source
    - Brief gaps (no metric for one persona segment, missing
      case study for an industry)
    - Assumptions about cadence / channel that may not match the
      rep's actual sending infrastructure

TOOLS YOU HAVE
  • search_web (DDG), brave_search, fetch_webpage: use SPARINGLY
    (~at most twice across the whole run) to verify ONE specific
    claim about a high-priority persona's company (recent funding,
    leadership change, product launch) when the row has the company
    name but no signal.

RESEARCH BUDGET: at most 6 tool calls total. The persona list +
brief are the primary signal — tools are for sharpening a few
high-stakes hooks, not for primary drafting.

ACCOUNTING
  • totalPersonas = personas array length
  • highPriorityCount = sum where isHighPriority is true
  • totalSteps = sum of sequence.length across all personas
  • segmentsCovered = unique segment strings used
  • Currency for any pricing references comes from the brief.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'agentPlan',
    'campaignTitle',
    'executiveSummary',
    'totalPersonas',
    'highPriorityCount',
    'totalSteps',
    'segmentsCovered',
    'topPerformingAngles',
    'segmentsToDeprioritize',
    'deliverabilityTips',
    'personas',
    'selfReviewNotes',
  ],
  properties: {
    agentPlan: { type: 'string', maxLength: 800 },
    campaignTitle: { type: 'string', maxLength: 160 },
    executiveSummary: { type: 'string', maxLength: 700 },
    totalPersonas: { type: 'integer' },
    highPriorityCount: { type: 'integer' },
    totalSteps: { type: 'integer' },
    selfReviewNotes: { type: 'string', maxLength: 600 },
    segmentsCovered: {
      type: 'array',
      maxItems: 12,
      items: { type: 'string', maxLength: 120 },
    },
    topPerformingAngles: {
      type: 'array',
      maxItems: 5,
      items: { type: 'string', maxLength: 240 },
    },
    segmentsToDeprioritize: {
      type: 'array',
      maxItems: 5,
      items: { type: 'string', maxLength: 240 },
    },
    deliverabilityTips: {
      type: 'array',
      maxItems: 6,
      items: { type: 'string', maxLength: 280 },
    },
    personas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'personaName',
          'jobTitle',
          'company',
          'segment',
          'openingHook',
          'matchedAngle',
          'matchedProofPoint',
          'sequence',
          'confidence',
          'isHighPriority',
          'personalizationNotes',
          'reasoning',
          'complianceFlags',
        ],
        properties: {
          personaName: { type: 'string', maxLength: 160 },
          jobTitle: { type: 'string', maxLength: 160 },
          company: { type: 'string', maxLength: 160 },
          segment: { type: 'string', maxLength: 120 },
          openingHook: { type: 'string', maxLength: 400 },
          matchedAngle: { type: 'string', maxLength: 200 },
          matchedProofPoint: { type: 'string', maxLength: 320 },
          confidence: { type: 'integer', minimum: 0, maximum: 100 },
          isHighPriority: { type: 'boolean' },
          personalizationNotes: {
            type: 'array',
            maxItems: 4,
            items: { type: 'string', maxLength: 280 },
          },
          reasoning: { type: 'string', maxLength: 400 },
          complianceFlags: {
            type: 'array',
            maxItems: 6,
            items: { type: 'string', maxLength: 240 },
          },
          sequence: {
            type: 'array',
            maxItems: 12,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['stepNumber', 'channel', 'dayOffset', 'body', 'callToAction'],
              properties: {
                stepNumber: { type: 'integer' },
                channel: {
                  type: 'string',
                  enum: ['email', 'linkedin', 'phone', 'other'],
                },
                dayOffset: { type: 'integer' },
                subject: { type: 'string', maxLength: 200 },
                subjectVariant: { type: 'string', maxLength: 200 },
                body: { type: 'string', maxLength: 1200 },
                callToAction: { type: 'string', maxLength: 240 },
                notes: { type: 'string', maxLength: 200 },
              },
            },
          },
        },
      },
    },
  },
} as const;

const outboundMcpServer = createSdkMcpServer({
  name: 'outbound-campaign',
  version: '1.0.0',
  tools: [braveSearchTool, searchWebTool, fetchWebpageTool],
});

export const outboundCampaign: AgentConfig<OutboundCampaignOutput> = {
  slug: 'outbound-campaign',
  name: 'Outbound Campaign Builder',
  description:
    'Upload your persona list + value-prop brief. The agent matches each persona to your strongest proof point, drafts a paste-ready multi-step sequence in your tone arc, validates every step against your hard don\'ts, and flags the personas worth de-prioritizing.',
  icon: '✉️',
  category: 'marketing',

  fileSlots: [
    {
      key: 'personas',
      label: 'Persona / account list',
      extensions: ['.csv', '.xlsx', '.xls'],
      maxSizeMB: 10,
      maxFiles: 1,
      description:
        'CSV / XLSX with one row per target. Name, title, company; intent signals or notes are bonus rocket fuel.',
      required: true,
    },
    {
      key: 'brief',
      label: 'Value-prop / product brief',
      extensions: ['.pdf', '.docx', '.txt', '.md'],
      maxSizeMB: 10,
      maxFiles: 1,
      description:
        'Your pitch deck, one-pager, or product brief. The agent quotes proof points only from what\'s in here.',
      required: true,
    },
  ],

  contextInput: {
    label: 'Campaign playbook',
    placeholder: '',
    helpText: 'Walk through the 8-question wizard above to set this.',
    required: true,
  },

  gate: {
    message:
      '{remaining} more persona sequences with paste-ready subjects + bodies, A/B subject variants, deliverability tips, and the agent\'s segment-priority call. Drop your email for the full campaign.',
    ctaText: 'Unlock Full Campaign',
    fields: [
      { name: 'email', type: 'email', label: 'Work email', required: true },
      {
        name: 'list_size',
        type: 'select',
        label: 'Typical campaign size',
        required: false,
        options: ['< 50 contacts', '50 – 250', '250 – 1,000', '1,000 – 5,000', '5,000+'],
      },
      {
        name: 'sales_motion',
        type: 'select',
        label: 'Sales motion',
        required: false,
        options: ['Founder-led', 'AE + SDR', 'Enterprise / field sales', 'Recruiter outbound'],
      },
    ],
  },

  llm: {
    model: 'claude-haiku-4-5',
    // Per-persona sequence drafting + brief mining + cross-batch
    // synthesis + self-review. 30 turns is comfortable headroom
    // for a 30-persona list with 0-2 tool calls.
    maxTurns: 30,
  },

  systemPrompt: SYSTEM_PROMPT,
  buildUserPrompt({ files, context }) {
    const personas = files.personas?.[0];
    const brief = files.brief?.[0];

    if (!personas) {
      throw new Error('Outbound Campaign Builder expected a file in the `personas` slot');
    }
    if (!brief) {
      throw new Error('Outbound Campaign Builder expected a file in the `brief` slot');
    }
    if (!context.trim()) {
      throw new Error(
        'Outbound Campaign Builder expected a playbook in `context` — walk through the wizard first.',
      );
    }

    const personasBody = truncateForModel(personas.text, 10_000);
    const briefBody = truncateForModel(brief.text, 8_000);

    const metaOf = (f: typeof personas): string => {
      if ('pageCount' in f.metadata) return `(${f.metadata.pageCount} pages)`;
      if ('rowCount' in f.metadata) return `(${f.metadata.rowCount} rows)`;
      return '';
    };

    return `CAMPAIGN PLAYBOOK (apply strictly):
${context.trim()}

---

PERSONA LIST (file: ${personas.filename} ${metaOf(personas)}):
${personasBody}

---

VALUE-PROP / PRODUCT BRIEF (file: ${brief.filename} ${metaOf(brief)}):
${briefBody}`;
  },

  mcpServer: outboundMcpServer,
  allowedTools: [
    'mcp__agent__brave_search',
    'mcp__agent__search_web',
    'mcp__agent__fetch_webpage',
  ],
  outputSchema: OUTPUT_SCHEMA as unknown as Record<string, unknown>,

  teaser(result) {
    const TEASER_COUNT = 2;
    const personas = result.personas ?? [];
    // Sort high-priority first (descending confidence), then the rest
    // by confidence. The teaser surfaces the strongest sequences;
    // visitors pay to unlock the rest.
    const sorted = [...personas].sort((a, b) => {
      if (a.isHighPriority !== b.isHighPriority) return a.isHighPriority ? -1 : 1;
      return (b.confidence ?? 0) - (a.confidence ?? 0);
    });
    const shown = sorted.slice(0, TEASER_COUNT);
    const remaining = Math.max(0, sorted.length - shown.length);
    return {
      teaser: { ...result, personas: shown },
      remaining,
      gated: remaining > 0,
    };
  },
};

/**
 * Lead Qualifier agent — Level 3 (Workflow).
 *
 * Pipeline:
 *
 *   ┌───────────────┐   ┌────────────────────┐   ┌─────────────────┐   ┌──────────────────┐
 *   │ Initial score │ → │ Pick enrichment    │ → │ Enrich (cond.)  │ → │ Final score +    │
 *   │    (LLM)      │   │   candidates       │   │ (tools, parallel│   │   outreach       │
 *   │               │   │     (code)         │   │                 │   │     (LLM)        │
 *   └───────────────┘   └────────────────────┘   └─────────────────┘   └──────────────────┘
 *
 *   1. Initial score:   Claude scores every lead from CSV alone (fast,
 *                       no tools). Captures rough fit + a confidence flag.
 *   2. Pick candidates: pure code — selects up to 5 ambiguous leads
 *                       (borderline scores or missing data) for research.
 *                       Hard cap prevents runaway DDG quota use.
 *   3. Enrich:          conditional. Skipped if no candidates picked.
 *                       Otherwise fans out searchWeb + fetchWebpage in
 *                       parallel for each candidate.
 *   4. Final + outreach: Claude does the final scoring (incorporating
 *                       enrichment) and generates outreach copy.
 *
 * Why split scoring into two passes:
 *   - The first pass is fast and cheap; a 100-lead CSV gets a rough
 *     score in ~2s.
 *   - Only ~5% of leads typically need enrichment (the borderline ones).
 *     Doing tool calls per-lead unconditionally would 20× the latency
 *     and cost without proportional accuracy gain.
 *   - Visitors see the conditional logic in the trace as a real branch:
 *     "Step 3 — skipped: all 23 leads had high-confidence scores".
 */
import { generateObject } from 'ai';
import { z } from 'zod';
import { truncateForModel } from '@/lib/parse-file';
import { cachedMessages } from '@/lib/prompt-caching';
import { fetchWebpage, searchWeb } from '@/lib/tools';
import type {
  AgentConfig,
  ParsedInput,
  ToolCallRecord,
  WorkflowDefinition,
  WorkflowStep,
} from './types';

// ---------------------------------------------------------------------------
// Output schema (preserved from Level-2 version)
// ---------------------------------------------------------------------------

const LeadScoreSchema = z.object({
  name: z.string(),
  email: z.string().optional(),
  score: z.number().int().min(0).max(100),
  grade: z.enum(['HOT', 'WARM', 'COLD']),
  reasoning: z.string().max(280),
  suggestedOutreach: z.string().max(280),
});

const LeadQualifierOutputSchema = z.object({
  totalLeads: z.number().int(),
  hotCount: z.number().int(),
  warmCount: z.number().int(),
  coldCount: z.number().int(),
  leads: z.array(LeadScoreSchema),
});

export type LeadQualifierOutput = z.infer<typeof LeadQualifierOutputSchema>;

// ---------------------------------------------------------------------------
// Internal state types
// ---------------------------------------------------------------------------

const TriagedLeadSchema = z.object({
  rowIndex: z.number().int().describe('1-based row index from the source CSV'),
  name: z.string(),
  email: z.string().optional(),
  company: z.string().optional(),
  domain: z.string().optional().describe('Company website domain if extractable, no protocol'),
  role: z.string().optional(),
  initialScore: z.number().int().min(0).max(100),
  initialReasoning: z.string().max(200),
  /** Set true when score is borderline OR ICP fit can't be judged from CSV alone. */
  uncertain: z.boolean(),
  /** Why this lead is uncertain — used to drive enrichment query selection. */
  uncertaintyReason: z.string().max(160).optional(),
});
type TriagedLead = z.infer<typeof TriagedLeadSchema>;

interface EnrichmentResult {
  rowIndex: number;
  searchSummary?: string;
  searchAbstract?: string;
  searchSource?: string;
  webpageTitle?: string;
  webpageDescription?: string;
  webpageText?: string;
}

interface QualifierState {
  leadFile: ParsedInput;
  icp: string;

  // After Triage
  triaged?: TriagedLead[];

  // After PickCandidates
  candidateRowIndices?: number[];

  // After Enrich (or skipped — empty array)
  enrichments?: EnrichmentResult[];

  // After FinalScoring
  finalOutput?: LeadQualifierOutput;
}

// ---------------------------------------------------------------------------
// System prompts (cached)
// ---------------------------------------------------------------------------

const TRIAGE_SYSTEM_PROMPT = `You are the triage phase of a B2B lead
qualification workflow. You score every lead from the source CSV using
ONLY the data in the row — no web research yet — and flag which leads
need deeper enrichment in a later step.

For each lead emit:
  - rowIndex:   1-based source row position. Preserve the input order.
  - name, email, company, domain, role: extract from the CSV. Leave
    optional fields out when not present. Do NOT invent data.
  - initialScore: 0-100 based on how well the CSV alone supports a fit
    against the user's ICP. Score conservatively when key signals
    (company, role) are missing.
  - initialReasoning: one short sentence citing actual row data.
  - uncertain: true when (a) the score lands in 40-70 (borderline), OR
    (b) ICP fit can't be judged because key fields are missing. False
    when the lead is clearly HOT (>=80) or clearly COLD (<=30).
  - uncertaintyReason: one short phrase explaining what's missing or
    ambiguous (used by the next step to pick what to research).

Never drop leads. Never invent leads. Output one record per input row.`;

const FINAL_SYSTEM_PROMPT = `You are the final-scoring phase of a B2B
lead qualification workflow. The triage phase has already scored each
lead from the CSV alone, and an enrichment phase has fetched live web
data for the most uncertain leads. Your job: produce the final score,
grade, reasoning, and outreach copy for EVERY lead.

Inputs you'll see:
  - The user's ICP.
  - The triaged leads (name, email, company, role, initialScore, etc.).
  - Enrichment results keyed by rowIndex (search abstracts, webpage
    descriptions). Many leads will have no enrichment — that's normal;
    don't penalize them for it.

Rules:
  - Final score (0-100) reflects ICP fit using the CSV data PLUS any
    enrichment available. If a lead was enriched, its reasoning MUST
    cite a concrete fact from the enrichment ("DDG abstract confirms
    fintech vertical, matches ICP" or "company website describes a
    50-person team — fits mid-market").
  - Grade: HOT 80-100, WARM 50-79, COLD 0-49.
  - reasoning: one short sentence. Cite actual data; no fluff.
  - suggestedOutreach: one paste-ready opener referencing something
    concrete (their role, company stage, recent news from enrichment).
  - Preserve input order. Never drop or invent leads.
  - totalLeads / hotCount / warmCount / coldCount must exactly match the
    returned array.`;

// ---------------------------------------------------------------------------
// Step 1 — Initial scoring
// ---------------------------------------------------------------------------

const triageStep: WorkflowStep<QualifierState> = {
  id: 'triage',
  name: 'Initial scoring (CSV only)',
  description: 'Claude scores every lead from the CSV alone and flags which need research.',
  async run(state, ctx) {
    const csvBody = truncateForModel(state.leadFile.text, 10_000);
    const icpBlock = state.icp.trim()
      ? `Ideal Customer Profile:\n${state.icp.trim()}`
      : 'Ideal Customer Profile: (not provided — use generic B2B sales judgment)';

    const result = await generateObject({
      model: ctx.model,
      schema: z.object({ leads: z.array(TriagedLeadSchema) }),
      messages: cachedMessages(
        TRIAGE_SYSTEM_PROMPT,
        `${icpBlock}\n\n---\n\nSource CSV (file: ${state.leadFile.filename}, ${state.leadFile.metadata.rowCount ?? 'unknown'} rows):\n${csvBody}`,
      ),
      temperature: 0.2,
      abortSignal: ctx.abortSignal,
    });

    const triaged = result.object.leads;
    const uncertainCount = triaged.filter((l) => l.uncertain).length;
    return {
      stateDelta: { triaged },
      summary: `Scored ${triaged.length} lead(s); flagged ${uncertainCount} as uncertain (will enrich up to top 5).`,
      modelTokens: result.usage?.totalTokens,
    };
  },
};

// ---------------------------------------------------------------------------
// Step 2 — Pick enrichment candidates (pure code)
// ---------------------------------------------------------------------------

const MAX_ENRICHMENT_CANDIDATES = 5;

const pickCandidatesStep: WorkflowStep<QualifierState> = {
  id: 'pick-candidates',
  name: 'Pick enrichment candidates',
  description:
    `Pure code. Selects up to ${MAX_ENRICHMENT_CANDIDATES} uncertain ` +
    'leads to enrich, prioritizing those with a usable company name or domain.',
  async run(state) {
    const triaged = state.triaged ?? [];
    // Prioritize leads we can actually research: must have a company name
    // or a domain. A lead flagged uncertain with no company info is just
    // structurally unscoreable; tools won't help.
    const enrichable = triaged
      .filter((l) => l.uncertain)
      .filter((l) => (l.company && l.company.trim()) || (l.domain && l.domain.trim()))
      // Light tie-breaker: prefer scores closer to 50 (most ambiguous).
      .sort(
        (a, b) =>
          Math.abs(a.initialScore - 50) - Math.abs(b.initialScore - 50),
      )
      .slice(0, MAX_ENRICHMENT_CANDIDATES);

    return {
      stateDelta: { candidateRowIndices: enrichable.map((l) => l.rowIndex) },
      summary:
        enrichable.length > 0
          ? `Selected ${enrichable.length} lead(s) for enrichment: rows ${enrichable.map((l) => l.rowIndex).join(', ')}.`
          : 'No enrichable candidates (no uncertain leads or none had company/domain info).',
    };
  },
};

// ---------------------------------------------------------------------------
// Step 3 — Enrich (conditional, parallel tool calls)
// ---------------------------------------------------------------------------

const enrichStep: WorkflowStep<QualifierState> = {
  id: 'enrich',
  name: 'Enrich uncertain leads (web research)',
  description:
    'Calls DuckDuckGo Instant Answer and the company website fetcher in ' +
    'parallel for each candidate. Skipped entirely if step 2 selected nobody.',
  condition(state) {
    const n = state.candidateRowIndices?.length ?? 0;
    if (n === 0) {
      return {
        run: false,
        reason: 'no uncertain leads needed enrichment',
      };
    }
    return true;
  },
  async run(state, ctx) {
    const triaged = state.triaged ?? [];
    const candidates = (state.candidateRowIndices ?? [])
      .map((idx) => triaged.find((l) => l.rowIndex === idx))
      .filter((l): l is TriagedLead => l != null);

    const toolCalls: ToolCallRecord[] = [];

    // Per-lead enrichment runs both tools in parallel; all leads also run
    // in parallel. With 5 leads × 2 tools, total wall time ≈ slowest tool.
    const enrichments: EnrichmentResult[] = await Promise.all(
      candidates.map(async (lead) => {
        const out: EnrichmentResult = { rowIndex: lead.rowIndex };

        const searchPromise = (async () => {
          // Prefer company name for the search; fall back to domain.
          const query = (lead.company ?? lead.domain ?? lead.name).trim();
          if (!query) return;
          const t0 = Date.now();
          const result = (await searchWeb.execute!(
            { query },
            { abortSignal: ctx.abortSignal, toolCallId: `srch-${lead.rowIndex}`, messages: [] },
          )) as Record<string, unknown>;
          const failed = typeof result.error === 'string';
          toolCalls.push({
            tool: 'searchWeb',
            args: { query },
            summary: failed
              ? `error: ${String(result.error)}`
              : result.empty
                ? 'no DDG abstract'
                : `${(result.heading as string) || 'ok'}${result.abstractSource ? ` · via ${result.abstractSource}` : ''}`,
            failed,
            durationMs: Date.now() - t0,
          });
          if (!failed && !result.empty) {
            out.searchSummary = (result.heading as string) || query;
            out.searchAbstract =
              typeof result.abstract === 'string' ? result.abstract : undefined;
            out.searchSource =
              typeof result.abstractSource === 'string'
                ? result.abstractSource
                : undefined;
          }
        })();

        const webpagePromise = (async () => {
          // Only fetch the homepage if we have a domain. Don't try to
          // construct a URL from the company name (too error-prone).
          if (!lead.domain || !lead.domain.trim()) return;
          const url = `https://${lead.domain.trim().replace(/^https?:\/\//, '')}`;
          const t0 = Date.now();
          const result = (await fetchWebpage.execute!(
            { url },
            { abortSignal: ctx.abortSignal, toolCallId: `web-${lead.rowIndex}`, messages: [] },
          )) as Record<string, unknown>;
          const failed = typeof result.error === 'string';
          toolCalls.push({
            tool: 'fetchWebpage',
            args: { url },
            summary: failed
              ? `error: ${String(result.error)}`
              : `${(result.title as string) || 'ok'} · ${typeof result.bytes === 'number' ? Math.round(result.bytes / 1024) + 'KB' : ''}`,
            failed,
            durationMs: Date.now() - t0,
          });
          if (!failed) {
            out.webpageTitle =
              typeof result.title === 'string' ? result.title : undefined;
            out.webpageDescription =
              typeof result.description === 'string'
                ? result.description
                : undefined;
            // Trim to keep the FinalScoring prompt manageable.
            out.webpageText =
              typeof result.text === 'string' ? result.text.slice(0, 1500) : undefined;
          }
        })();

        await Promise.all([searchPromise, webpagePromise]);
        return out;
      }),
    );

    return {
      stateDelta: { enrichments },
      summary:
        `Enriched ${enrichments.length} lead(s) via ${toolCalls.length} tool call(s).`,
      toolCalls,
    };
  },
};

// ---------------------------------------------------------------------------
// Step 4 — Final scoring + outreach
// ---------------------------------------------------------------------------

const finalScoringStep: WorkflowStep<QualifierState> = {
  id: 'final-scoring',
  name: 'Final scoring + outreach generation',
  description:
    'Claude produces the final score, grade, reasoning, and outreach copy ' +
    'for every lead — citing enrichment facts where available.',
  async run(state, ctx) {
    const triaged = state.triaged ?? [];
    const enrichments = state.enrichments ?? [];
    const enrichmentByRow = new Map(enrichments.map((e) => [e.rowIndex, e]));

    // Compose a compact JSON payload: triaged leads with any enrichment
    // attached inline. Keeps the prompt easy to read for the model.
    const composed = triaged.map((lead) => {
      const enrich = enrichmentByRow.get(lead.rowIndex);
      return enrich ? { ...lead, enrichment: enrich } : lead;
    });

    const result = await generateObject({
      model: ctx.model,
      schema: LeadQualifierOutputSchema,
      messages: cachedMessages(
        FINAL_SYSTEM_PROMPT,
        `Ideal Customer Profile:
${state.icp.trim() || '(not provided — use generic B2B judgment)'}

---

Triaged leads (with enrichment attached where available):

${JSON.stringify(composed, null, 2)}`,
      ),
      temperature: 0.2,
      abortSignal: ctx.abortSignal,
    });

    return {
      stateDelta: { finalOutput: result.object },
      summary: `Final scoring: ${result.object.hotCount} HOT, ${result.object.warmCount} WARM, ${result.object.coldCount} COLD.`,
      modelTokens: result.usage?.totalTokens,
    };
  },
};

// ---------------------------------------------------------------------------
// Workflow definition
// ---------------------------------------------------------------------------

const leadQualifierWorkflow: WorkflowDefinition<QualifierState, LeadQualifierOutput> = {
  initialState({ files, context }) {
    const leadFile = files.leads?.[0];
    if (!leadFile) {
      throw new Error('Lead Qualifier expected a file in the `leads` slot');
    }
    return { leadFile, icp: context };
  },
  steps: [triageStep, pickCandidatesStep, enrichStep, finalScoringStep],
  finalize(state) {
    if (!state.finalOutput) {
      throw new Error('Workflow finished without producing final output');
    }
    return state.finalOutput;
  },
};

// ---------------------------------------------------------------------------
// Agent config
// ---------------------------------------------------------------------------

export const leadQualifier: AgentConfig<LeadQualifierOutput> = {
  slug: 'lead-qualifier',
  name: 'Lead Qualifier',
  description:
    'Upload a lead list. Every row scored 0-100 with a reason and a ready-to-send opener.',
  icon: '🎯',
  category: 'sales',

  fileSlots: [
    {
      key: 'leads',
      label: 'Lead list',
      extensions: ['.csv', '.xlsx', '.xls'],
      maxSizeMB: 5,
      maxFiles: 1,
      description: 'Drop your lead CSV or Excel file',
      required: true,
    },
  ],

  contextInput: {
    label: 'Your Ideal Customer Profile (ICP)',
    placeholder:
      'e.g., SaaS companies, 50-500 employees, VP Engineering or CTO, US/EU, actively hiring, using AWS or GCP',
    helpText:
      'Describe the leads you consider a great fit. The more specific, the sharper the scoring. Leave blank to use generic B2B defaults.',
    required: false,
  },

  gate: {
    message:
      '{remaining} more leads scored, ranked, and ready to contact. Drop your email to see the full report.',
    ctaText: 'Unlock Full Report',
    fields: [
      { name: 'email', type: 'email', label: 'Work email', required: true },
      {
        name: 'companySize',
        type: 'select',
        label: 'Company size',
        required: false,
        options: ['1-10', '11-50', '51-200', '201-1000', '1000+'],
      },
    ],
  },

  llm: {
    model: 'claude-haiku-4-5',
    temperature: 0.2,
    maxOutputTokens: 4000,
  },

  tools: { searchWeb, fetchWebpage },

  workflow: leadQualifierWorkflow as WorkflowDefinition<unknown, LeadQualifierOutput>,

  schema: LeadQualifierOutputSchema,

  teaser(result) {
    const TEASER_COUNT = 3;
    const leads = result.leads ?? [];
    const shown = leads.slice(0, TEASER_COUNT);
    const remaining = Math.max(0, leads.length - shown.length);
    return {
      teaser: { ...result, leads: shown },
      remaining,
      gated: remaining > 0,
    };
  },
};

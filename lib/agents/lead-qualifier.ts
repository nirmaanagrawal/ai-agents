/**
 * Lead Qualifier — Claude Agent SDK edition.
 *
 * Architecture shift from the previous workflow-runner version:
 *   We don't declare explicit steps anymore. Claude runs the loop
 *   itself — it reads the CSV, decides which leads need enrichment,
 *   calls search_web / fetch_webpage as needed, and emits the final
 *   structured output. The system prompt below is the only place we
 *   describe "when to use which tool". No separate triage / pick /
 *   enrich / final functions to maintain.
 *
 * Trade-off vs declarative workflow:
 *   + Less code, less to maintain
 *   + Agent can branch in ways we didn't predict (the right kind of
 *     emergence for sales/qualification work)
 *   - Less observability into "which step ran" (we record per-turn,
 *     but the boundaries are fuzzier than named steps were)
 *   - Slightly less deterministic — same input may produce slightly
 *     different tool-call sequences across runs
 */
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { checkHiringIntentTool } from '@/lib/agent-tools/check-hiring-intent';
import { fetchWebpageTool } from '@/lib/agent-tools/fetch-webpage';
import { searchWebTool } from '@/lib/agent-tools/search-web';
import { truncateForModel } from '@/lib/parse-file';
import type { AgentConfig } from './types';

interface LeadOut {
  name: string;
  email?: string;
  score: number;
  grade: 'HOT' | 'WARM' | 'COLD';
  reasoning: string;
  suggestedOutreach: string;
}
export interface LeadQualifierOutput {
  totalLeads: number;
  hotCount: number;
  warmCount: number;
  coldCount: number;
  leads: LeadOut[];
}

const SYSTEM_PROMPT = `You are a B2B sales lead-qualification agent.

INPUTS YOU RECEIVE
  • An Ideal Customer Profile (ICP) — describes a great-fit lead.
  • A list of leads as JSON rows (from a visitor's CSV).

YOUR JOB
  Score every lead 0-100 against the ICP and produce a structured
  output. Generate a paste-ready outreach opener for each lead.

TOOLS AVAILABLE
  • search_web(query):  DuckDuckGo Instant Answer. Good for well-known
                        companies. Returns {empty: true} for long-tail
                        private companies — that's a signal to fall
                        back to fetch_webpage.
  • fetch_webpage(url): Fetch the company's https://{domain} for their
                        own description. Use as a fallback when
                        search_web is empty AND the lead row has a
                        domain we can hit.
  • check_hiring_intent(domain): Probe a company's careers page for
                        engineering-role posts. Strong HOT signal —
                        if found:true and postsCount > 5, weight the
                        lead's score +10 to +15 and prefer HOT grade.
                        Use this on every lead that has a domain AND
                        is borderline (40-70) or already trending HOT.

RESEARCH BUDGET
  At most 12 tool calls total across the entire batch. Spend them on
  borderline leads, or leads where hiring intent could push them HOT.
  Skip clear-cut COLD (≤30) cases — they're not worth research budget.
  Never call the same tool with the same args twice.

GRADES
  HOT  = 80-100   strong ICP match AND (a buying signal / senior role
                  / active hiring intent confirmed via check_hiring_intent)
  WARM = 50-79    partial ICP match, worth nurture
  COLD = 0-49     weak fit or insufficient information

HIRING-INTENT BOOST
  When check_hiring_intent returns found:true with postsCount ≥ 5,
  apply a +10 to +15 score boost to that lead. PostsCount ≥ 15
  combined with a senior-role title (VP / Director / Head / CTO) is
  a near-automatic HOT regardless of other ICP gaps — open engineering
  roles signal active buying. Cite the boost in your reasoning
  ("found 12 engineering roles open per careers page → +15 → HOT").

RULES
  • reasoning must cite actual data from the row OR the tool result.
    No generic fluff like "looks promising". If you used a tool, name
    what it told you ("DDG abstract confirms fintech vertical").
  • suggestedOutreach is one sentence the rep could paste, referencing
    something concrete (their role, company stage, recent news).
  • Preserve input row order. Never invent leads that weren't given.
  • Set totalLeads / hotCount / warmCount / coldCount to exactly match
    the returned array.`;

// `additionalProperties: false` matters for Claude's structured-output mode —
// without it the model sometimes adds stray fields and our retries burn out.
// `email` is intentionally NOT in `required` (some leads have no email).
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['totalLeads', 'hotCount', 'warmCount', 'coldCount', 'leads'],
  properties: {
    totalLeads: { type: 'integer' },
    hotCount: { type: 'integer' },
    warmCount: { type: 'integer' },
    coldCount: { type: 'integer' },
    leads: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'score', 'grade', 'reasoning', 'suggestedOutreach'],
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
          score: { type: 'integer', minimum: 0, maximum: 100 },
          grade: { type: 'string', enum: ['HOT', 'WARM', 'COLD'] },
          reasoning: { type: 'string', maxLength: 280 },
          suggestedOutreach: { type: 'string', maxLength: 280 },
        },
      },
    },
  },
} as const;

// In-process MCP server holding this agent's tools. Tool names visible
// to Claude become `mcp__leads__search_web`, `mcp__leads__fetch_webpage`,
// and `mcp__leads__check_hiring_intent`.
const leadsMcpServer = createSdkMcpServer({
  name: 'leads',
  version: '1.0.0',
  tools: [searchWebTool, fetchWebpageTool, checkHiringIntentTool],
});

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
    // 25 turns: 3 tools × up to N borderline leads + reasoning + final.
    // The hiring-intent tool especially can run on every lead with a
    // domain — give the SDK headroom to do thorough enrichment without
    // hitting the cap.
    maxTurns: 25,
  },

  systemPrompt: SYSTEM_PROMPT,
  buildUserPrompt({ files, context }) {
    const file = files.leads?.[0];
    if (!file) {
      throw new Error('Lead Qualifier expected a file in the `leads` slot');
    }
    const body = truncateForModel(file.text, 10_000);
    const icpBlock = context.trim()
      ? `Ideal Customer Profile:\n${context.trim()}`
      : 'Ideal Customer Profile: (not provided — use generic B2B sales judgment)';
    return `${icpBlock}\n\n---\n\nFile: ${file.filename}\nRow count: ${file.metadata.rowCount ?? 'unknown'}\n\nLeads (JSON array):\n${body}`;
  },

  mcpServer: leadsMcpServer,
  // The runtime always registers the agent's MCP server under the key
  // `agent`, so Claude sees tool names as `mcp__agent__{tool}` regardless
  // of what we named the server internally. Keep the names in sync here.
  allowedTools: [
    'mcp__agent__search_web',
    'mcp__agent__fetch_webpage',
    'mcp__agent__check_hiring_intent',
  ],
  outputSchema: OUTPUT_SCHEMA as unknown as Record<string, unknown>,

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

/**
 * Resume Screener — JD-driven candidate screening with dynamic
 * wizard.
 *
 * Flow (different from every other agent in the marketplace):
 *   1. Visitor uploads the JD only.
 *   2. Server reads the JD, generates a custom 8-12 MCQ wizard
 *      (skills, experience, location, deal-breakers — all extracted
 *      from the JD).
 *   3. Visitor answers the wizard. The composed answers become the
 *      screening rubric.
 *   4. Visitor uploads up to 20 resumes (PDF or text).
 *   5. Agent scores every resume against the JD + rubric.
 *
 * Why dynamic wizard:
 *   Preset MCQs ("How important are React skills?") are useless when
 *   half of all roles aren't React roles. Reading the JD first means
 *   the questions can ask "Which of THESE skills are must-have:
 *   [Python, Kafka, Snowflake, dbt, Airflow, K8s]" — actual options
 *   that came from the JD.
 *
 * Output: per-candidate scorecard with match score, key strengths,
 *   gaps, recommended interview questions, and a personalized
 *   outreach opener.
 */
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { fetchWebpageTool } from '@/lib/agent-tools/fetch-webpage';
import { searchWebTool } from '@/lib/agent-tools/search-web';
import { truncateForModel } from '@/lib/parse-file';
import type { AgentConfig, ParsedInput } from './types';

interface CandidateOut {
  candidateName: string;
  email?: string;
  phone?: string;
  currentTitle?: string;
  currentCompany?: string;
  yearsExperience?: number;
  location?: string;
  matchScore: number;
  grade: 'SHORTLIST' | 'REVIEW' | 'REJECT';
  keyStrengths: string[];
  keyGaps: string[];
  redFlags: string[];
  reasoning: string;
  suggestedInterviewQuestions: string[];
  personalizedOutreach: string;
  recommendedNextStep: string;
  resumeFilename: string;
}

export interface ResumeScreenerOutput {
  jobTitle: string;
  totalCandidates: number;
  shortlistCount: number;
  reviewCount: number;
  rejectCount: number;
  screeningSummary: string;
  candidates: CandidateOut[];
}

const SYSTEM_PROMPT = `You are an expert technical recruiter screening
resumes against a specific JD and a hiring-manager-defined rubric.

INPUTS YOU RECEIVE
  • The JD text (uploaded by the visitor).
  • A SCREENING RUBRIC (the visitor's wizard answers, as structured
    markdown with sections per dimension).
  • One or more resume files. Each is a separate [FILE: ...] block.

YOUR JOB
  For each resume:
    1. Extract: candidate name, current title + company, years of
       relevant experience, location, email/phone if present.
    2. Score the candidate against the JD's hard requirements + the
       wizard rubric. Be honest — most resumes are mediocre fits.
    3. Pick a grade:
         SHORTLIST (80-100): meets all must-have requirements + most
                             nice-to-haves. Worth bringing in.
         REVIEW   (50-79):   meets the core requirements but has
                             gaps the recruiter should review with
                             the hiring manager.
         REJECT   (0-49):    fails one or more must-haves OR has
                             red flags. Polite no.
    4. Write 3-5 interview questions targeted at this specific
       candidate's gaps or claims worth probing ("You list 5 years
       of Kafka but no production deployments — walk me through
       the largest topic / consumer-group scale you've operated.").
    5. Write a 1-2 sentence personalized outreach opener the
       recruiter could paste into an email — referencing a specific
       project / company / detail from THIS resume.
    6. Recommend a concrete next step ("Schedule 30-min screening
       call" / "Pass to hiring manager for review" / "Send polite
       decline — no Python production experience").

TOOLS AVAILABLE
  • search_web(query):     DDG Instant Answer. Use SPARINGLY to look
                           up the candidate's current company if
                           it's an unfamiliar name and that context
                           matters for the score (e.g., to verify
                           it's a real company at the claimed scale).
  • fetch_webpage(url):    Pull a public URL referenced in the
                           resume (e.g., a personal site / blog).
                           Don't fetch LinkedIn — it gates content.

RESEARCH BUDGET
  At most 6 tool calls total. Most resumes don't need any. Use
  budget only when verification would change the grade.

ACCURACY RULES
  • NEVER invent skills / years / titles the resume doesn't claim.
    If the resume is silent on something the JD requires, mark it
    as a gap, not a guess.
  • redFlags are objective concerns: < 1 year tenure repeated,
    unexplained 2+ year gaps, claimed skills that don't appear in
    described projects, etc. Don't list opinions.
  • Cite real specifics in reasoning ("4 years at Stripe building
    payment-rails APIs in Go — directly matches your Go + payments
    requirement"). No fluff.
  • If multiple resumes look identical (same person submitted
    twice / template-driven AI applications) flag both as REVIEW.

ACCOUNTING
  totalCandidates / shortlistCount / reviewCount / rejectCount
  must exactly match the returned candidates array.
  jobTitle is extracted from the JD (your best read of "this role
  is hiring for X"). screeningSummary is 2-3 sentences for the
  recruiter's daily update — headline number + top concern.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'jobTitle',
    'totalCandidates',
    'shortlistCount',
    'reviewCount',
    'rejectCount',
    'screeningSummary',
    'candidates',
  ],
  properties: {
    jobTitle: { type: 'string', maxLength: 120 },
    totalCandidates: { type: 'integer' },
    shortlistCount: { type: 'integer' },
    reviewCount: { type: 'integer' },
    rejectCount: { type: 'integer' },
    screeningSummary: { type: 'string', maxLength: 600 },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'candidateName',
          'matchScore',
          'grade',
          'keyStrengths',
          'keyGaps',
          'redFlags',
          'reasoning',
          'suggestedInterviewQuestions',
          'personalizedOutreach',
          'recommendedNextStep',
          'resumeFilename',
        ],
        properties: {
          candidateName: { type: 'string', maxLength: 120 },
          email: { type: 'string', maxLength: 200 },
          phone: { type: 'string', maxLength: 40 },
          currentTitle: { type: 'string', maxLength: 120 },
          currentCompany: { type: 'string', maxLength: 120 },
          yearsExperience: { type: 'number', minimum: 0, maximum: 60 },
          location: { type: 'string', maxLength: 120 },
          matchScore: { type: 'integer', minimum: 0, maximum: 100 },
          grade: { type: 'string', enum: ['SHORTLIST', 'REVIEW', 'REJECT'] },
          keyStrengths: { type: 'array', items: { type: 'string', maxLength: 200 } },
          keyGaps: { type: 'array', items: { type: 'string', maxLength: 200 } },
          redFlags: { type: 'array', items: { type: 'string', maxLength: 200 } },
          reasoning: { type: 'string', maxLength: 400 },
          suggestedInterviewQuestions: {
            type: 'array',
            minItems: 0,
            maxItems: 6,
            items: { type: 'string', maxLength: 280 },
          },
          personalizedOutreach: { type: 'string', maxLength: 320 },
          recommendedNextStep: { type: 'string', maxLength: 200 },
          resumeFilename: { type: 'string', maxLength: 200 },
        },
      },
    },
  },
} as const;

const screenerMcpServer = createSdkMcpServer({
  name: 'screener',
  version: '1.0.0',
  tools: [searchWebTool, fetchWebpageTool],
});

export const resumeScreener: AgentConfig<ResumeScreenerOutput> = {
  slug: 'resume-screener',
  name: 'Resume Screener',
  description:
    'Upload a JD. Answer a few questions tailored to that JD. Drop up to 20 resumes. Get a ranked shortlist with reasoning, interview questions, and ready-to-send outreach.',
  icon: '📄',
  category: 'hr',

  fileSlots: [
    {
      key: 'jd',
      label: 'Job description',
      extensions: ['.pdf', '.docx', '.txt', '.md'],
      maxSizeMB: 5,
      maxFiles: 1,
      description: 'Drop the JD as PDF / DOCX / TXT. The wizard tunes to whatever\'s in it.',
      required: true,
    },
    {
      key: 'resumes',
      label: 'Resumes',
      extensions: ['.pdf', '.docx', '.txt'],
      maxSizeMB: 10,
      maxFiles: 20,
      description: 'Drop up to 20 resumes (PDF / DOCX / TXT).',
      required: true,
    },
  ],

  // contextInput exists because the dynamic wizard's composed output
  // is passed in as `context`. The label here is what the rare free-
  // text fallback box would show — visitors should normally only see
  // the wizard.
  contextInput: {
    label: 'Screening rubric',
    placeholder: '',
    helpText: 'Auto-built from the JD via the wizard above.',
    required: true,
  },

  gate: {
    message:
      '{remaining} more candidates scored with strengths, gaps, interview questions, and outreach drafts. Drop your email for the full shortlist.',
    ctaText: 'Unlock Full Shortlist',
    fields: [
      { name: 'email', type: 'email', label: 'Work email', required: true },
      {
        name: 'role_volume',
        type: 'select',
        label: 'Roles you screen for per month',
        required: false,
        options: ['1-5', '5-20', '20-50', '50+'],
      },
      {
        name: 'team_size',
        type: 'select',
        label: 'Recruiting team size',
        required: false,
        options: ['Solo / founder', '2-5', '6-20', '20+'],
      },
    ],
  },

  llm: {
    model: 'claude-haiku-4-5',
    // 20 resumes × extraction + scoring + reasoning + occasional
    // tool call ≈ 30+ turns. Setting high enough that batches of
    // 20 resumes complete reliably.
    maxTurns: 35,
  },

  systemPrompt: SYSTEM_PROMPT,
  buildUserPrompt({ files, context }) {
    const jd = files.jd?.[0];
    if (!jd) throw new Error('Resume Screener expected a JD in the `jd` slot');
    const resumes = files.resumes ?? [];
    if (resumes.length === 0) {
      throw new Error('Resume Screener expected at least one resume in the `resumes` slot');
    }
    if (!context.trim()) {
      throw new Error(
        'Resume Screener expected a screening rubric in `context` — walk through the JD-tuned wizard first.',
      );
    }

    const jdBlock = truncateForModel(jd.text, 6_000);
    const resumesBlock = resumes
      .map((r: ParsedInput) => {
        const body = truncateForModel(r.text, 5_000);
        return `[FILE: ${r.filename}]\n${body}`;
      })
      .join('\n\n---\n\n');

    return `JOB DESCRIPTION (file: ${jd.filename}):
${jdBlock}

---

SCREENING RUBRIC (the hiring manager's answers to the JD-tuned wizard):
${context.trim()}

---

RESUMES TO SCREEN (${resumes.length} file${resumes.length === 1 ? '' : 's'}):

${resumesBlock}`;
  },

  mcpServer: screenerMcpServer,
  allowedTools: ['mcp__agent__search_web', 'mcp__agent__fetch_webpage'],
  outputSchema: OUTPUT_SCHEMA as unknown as Record<string, unknown>,

  // THIS is the new bit — opt into the dynamic wizard flow,
  // triggered by the JD upload.
  dynamicWizard: { triggerSlot: 'jd' },

  teaser(result) {
    const TEASER_COUNT = 3;
    const candidates = result.candidates ?? [];
    // Sort by matchScore descending so the teaser shows the
    // strongest candidates up top — what the hiring manager
    // actually wants to see free.
    const sorted = [...candidates].sort(
      (a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0),
    );
    const shown = sorted.slice(0, TEASER_COUNT);
    const remaining = Math.max(0, sorted.length - shown.length);
    return {
      teaser: { ...result, candidates: shown },
      remaining,
      gated: remaining > 0,
    };
  },
};

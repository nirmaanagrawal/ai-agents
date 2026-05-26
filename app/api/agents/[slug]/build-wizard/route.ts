/**
 * POST /api/agents/[slug]/build-wizard
 *
 * Accepts: multipart/form-data with a single file (the agent's
 *          `dynamicWizard.triggerSlot` file — typically a JD).
 * Returns: JSON `{ wizard: WizardDefinition }` — questions tuned to
 *          what the file actually contains.
 *
 * This route only runs for agents that have `dynamicWizard` set.
 * It's a one-shot Claude call (no tools, no agent loop) that reads
 * the trigger file and emits a structured wizard the client can
 * render via the same IcpWizard component every preset wizard uses.
 *
 * Why this lives in a separate route (vs. inside /process):
 *   The wizard build has to happen BEFORE the visitor uploads the
 *   rest of their files. Two HTTP round-trips, two separate UI
 *   stages. Keeping the endpoints split keeps each one focused on
 *   one thing.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { chmodSync, existsSync } from 'fs';
import { join } from 'path';
import { getAgent } from '@/lib/agents/registry';
import { parseFile } from '@/lib/parse-file';

/**
 * Same binary-resolution dance as agent-runtime.ts. Without this the
 * SDK fails on Vercel with "Native CLI binary for linux-x64 not found"
 * because Next.js's serverless bundler doesn't reliably auto-detect
 * the SDK's optional per-platform binary deps.
 */
function resolveClaudeBinary(): string | undefined {
  const platform = process.platform;
  const arch = process.arch;
  const pkgName = `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`;
  const binaryName = platform === 'win32' ? 'claude.exe' : 'claude';
  const candidates = [
    join(process.cwd(), 'node_modules', pkgName, binaryName),
    join(process.cwd(), '.next', 'standalone', 'node_modules', pkgName, binaryName),
    join('/var/task', 'node_modules', pkgName, binaryName),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        chmodSync(path, 0o755);
      } catch {
        /* read-only mount — perm may already be correct */
      }
      return path;
    }
  }
  return undefined;
}

export const runtime = 'nodejs';
// One-shot LLM call. Generous timeout since the JD could be large,
// but nowhere near the agent-run timeouts.
export const maxDuration = 120;
const TIMEOUT_MS = 90_000;

const SYSTEM_PROMPT = `You are an expert technical recruiter. Read the
provided file and design a TIGHT screening wizard — at most 4
questions a hiring manager will answer to anchor the screening rubric
for this specific role. The hiring manager's time matters more than
breadth; ask only what genuinely changes the outcome.

CRITICAL RULES
  • Questions and options MUST be specific to THIS file. Generic
    questions ("How important is communication?") are forbidden —
    anyone could write those without reading the file.
  • At most 4 questions. 3 is better if the JD doesn't demand a 4th.
  • Required fields: id (snake_case), kind ("single" or "multi"),
    prompt ("N / N — " prefix), options (4-8 plausible choices),
    required (true for must-haves + min-experience).
  • Use kind="multi" for "which of these" lists, kind="single" for
    threshold questions like minimum years.

PICK YOUR QUESTIONS FROM THIS RANKED LIST — STOP AT 4
  1. MUST-HAVE skills (multi, REQUIRED) — list the 6-10 most
     prominent skills/tools/technologies from the JD as options.
     The hiring manager picks which subset is non-negotiable. This
     is the single highest-signal question — never skip.
  2. Minimum years of relevant experience (single, REQUIRED) —
     ranges like "1-3", "3-5", "5-8", "8+" tuned to the seniority
     wording in the JD.
  3. Deal-breakers (multi, optional) — list 5-8 things that would
     instant-disqualify a candidate FOR THIS ROLE. Pull these from
     hard requirements in the JD: missing degree if required, no
     valid work authorization, no production experience with a
     critical tool, location mismatch, etc. ONLY include this
     question if the JD has clear hard-disqualifiers worth asking
     about.
  4. Seniority bar (single, optional) — IC vs Senior IC vs Staff
     vs Principal vs Manager. ONLY include if the JD title is
     ambiguous or the JD targets multiple levels.

SKIP THESE EVEN IF THE JD MENTIONS THEM
  Location / work model — almost always stated in the JD; the agent
    can extract.
  Soft skills — too subjective for MCQ; the agent infers from
    resume language.
  Education — rarely a hard filter in practice; only ask as a
    deal-breaker if the JD explicitly says "Required: BS/MS in X".
  Nice-to-haves — they're nice-to-have; not worth a wizard slot.
  Industry domain — extractable from JD, low rubric-changing signal.

OUTPUT FORMAT — STRICT JSON
  Single JSON object. First char \`{\`, last \`}\`. No markdown.
  Number prompts as "N / TOTAL — " where TOTAL = the actual count
  of questions you're emitting (not 12).`;

const WIZARD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'questions'],
  properties: {
    title: {
      type: 'string',
      maxLength: 80,
      description:
        'Header above the progress bar. e.g. "Screening criteria for Senior Backend Engineer".',
    },
    questions: {
      type: 'array',
      // Tight cap. The wizard's friction-vs-signal tradeoff falls
      // off a cliff past 4 questions. 2 minimum so we always at
      // least cover must-have skills + min-experience.
      minItems: 2,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'kind', 'prompt', 'options'],
        properties: {
          id: {
            type: 'string',
            pattern: '^[a-z0-9_]+$',
            maxLength: 50,
          },
          kind: { type: 'string', enum: ['single', 'multi'] },
          prompt: { type: 'string', maxLength: 250 },
          helpText: { type: 'string', maxLength: 200 },
          options: {
            type: 'array',
            minItems: 3,
            maxItems: 12,
            items: { type: 'string', maxLength: 120 },
          },
          required: { type: 'boolean' },
          allowOther: { type: 'boolean' },
        },
      },
    },
  },
} as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const agent = getAgent(slug);
  if (!agent) {
    return Response.json({ error: 'Agent not found' }, { status: 404 });
  }
  if (!agent.dynamicWizard) {
    return Response.json(
      { error: `Agent "${slug}" doesn't support dynamic wizard generation.` },
      { status: 400 },
    );
  }

  // --- 1. Parse multipart body --------------------------------------
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (e) {
    return Response.json(
      { error: 'Invalid multipart body', detail: String(e) },
      { status: 400 },
    );
  }

  // The client posts the trigger-slot file under the slot key.
  const triggerSlotKey = agent.dynamicWizard.triggerSlot;
  const file = formData.getAll(triggerSlotKey).find((v): v is File => v instanceof File);
  if (!file) {
    return Response.json(
      { error: `Expected a file under field "${triggerSlotKey}"` },
      { status: 400 },
    );
  }

  // Validate against the slot's extension list — same constraints
  // as the main process route uses.
  const slot = agent.fileSlots.find((s) => s.key === triggerSlotKey);
  if (slot) {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!slot.extensions.includes(ext)) {
      return Response.json(
        {
          error: `${file.name} has unsupported extension. Accepted: ${slot.extensions.join(', ')}`,
        },
        { status: 400 },
      );
    }
    if (file.size > slot.maxSizeMB * 1024 * 1024) {
      return Response.json(
        { error: `${file.name} exceeds ${slot.maxSizeMB}MB` },
        { status: 400 },
      );
    }
  }

  // --- 2. Parse the file to text -----------------------------------
  let parsed;
  try {
    parsed = await parseFile(file);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(
      {
        error: `Could not read the file: ${msg}. If it's a scanned PDF, run it through OCR first (Adobe Acrobat → Export Data → Recognize Text), then re-upload.`,
      },
      { status: 400 },
    );
  }

  // Handle the scanned-PDF case — pdf-parse succeeds but yields very
  // short text. With < 200 characters we can't meaningfully build
  // wizard questions; surface a clear error early instead of letting
  // Claude return useless options.
  if (parsed.text.length < 200) {
    return Response.json(
      {
        error: `The file parsed to only ${parsed.text.length} characters — too little to build a wizard from. Likely a scanned/image-only PDF without a text layer. Run it through OCR or paste the JD into a .txt / .docx file and re-upload.`,
      },
      { status: 400 },
    );
  }

  // Trim — JDs over 8k chars are unusual; padding above this is
  // usually boilerplate equal-opportunity notices.
  const fileBody = parsed.text.length > 8_000 ? parsed.text.slice(0, 8_000) : parsed.text;
  const t0 = Date.now();
  const binaryPath = resolveClaudeBinary();
  console.log(
    `[build-wizard:${slug}] file=${file.name} chars=${parsed.text.length} → ${fileBody.length} (truncated) ` +
      `binary=${binaryPath ?? 'AUTO-DISCOVERY'} platform=${process.platform}-${process.arch}`,
  );

  // --- 3. Call Claude one-shot to build the wizard -----------------
  // Same pattern as agent-runtime: schema embedded in prompt, parse
  // the result string, fall through to robust JSON extraction if
  // Claude wraps in markdown.
  const userPrompt = `Build a screening wizard tailored to this file:

[FILE: ${parsed.filename}]
${fileBody}

---

Schema your JSON output must match:
${JSON.stringify(WIZARD_SCHEMA, null, 2)}

Return ONLY the JSON object. No markdown. No commentary. First char \`{\`, last char \`}\`.`;

  const abortController = new AbortController();
  const abortTimer = setTimeout(() => abortController.abort(), TIMEOUT_MS);

  // Same diagnostic capture as agent-runtime: track every message type
  // we see so on-stream-end without-result we know what came through.
  const messageHistogram = new Map<string, number>();
  let resultText: string | undefined;
  let resultSubtype: string | undefined;
  try {
    for await (const message of query({
      prompt: userPrompt,
      options: {
        model: 'claude-haiku-4-5',
        systemPrompt: SYSTEM_PROMPT,
        maxTurns: 2,
        // Serverless hardening (same as agent-runtime):
        //   cwd → must be writable; only /tmp is on Vercel functions
        //   env.HOME → SDK writes session files / config to $HOME
        //   pathToClaudeCodeExecutable → forces the bundled binary
        cwd: '/tmp',
        env: { ...process.env, HOME: '/tmp' },
        ...(binaryPath ? { pathToClaudeCodeExecutable: binaryPath } : {}),
        permissionMode: 'bypassPermissions',
        abortSignal: abortController.signal,
      } as never,
    } as never)) {
      const msg = message as {
        type?: string;
        subtype?: string;
        result?: unknown;
      };
      const tag = `${msg.type}${msg.subtype ? ':' + msg.subtype : ''}`;
      messageHistogram.set(tag, (messageHistogram.get(tag) ?? 0) + 1);
      if (msg.type === 'result') {
        resultSubtype = msg.subtype;
        if (msg.subtype === 'success' && typeof msg.result === 'string') {
          resultText = msg.result;
        }
      }
    }
  } catch (e) {
    clearTimeout(abortTimer);
    const msg = e instanceof Error ? e.message : String(e);
    const histogram = Array.from(messageHistogram.entries())
      .map(([k, v]) => `${k}×${v}`)
      .join(', ');
    console.error(
      `[build-wizard:${slug}] failed after ${Date.now() - t0}ms · histogram=[${histogram}] · err=${msg}`,
    );
    return Response.json(
      {
        error: `Wizard build failed: ${msg}. (Saw messages: ${histogram || 'none'})`,
      },
      { status: 502 },
    );
  }
  clearTimeout(abortTimer);

  if (!resultText) {
    const histogram = Array.from(messageHistogram.entries())
      .map(([k, v]) => `${k}×${v}`)
      .join(', ');
    console.error(
      `[build-wizard:${slug}] no result · histogram=[${histogram}] · resultSubtype=${resultSubtype}`,
    );
    return Response.json(
      {
        error: `Wizard build returned no usable result (subtype: ${resultSubtype ?? 'none'}). Saw: [${histogram || 'no messages'}]. The SDK subprocess may have crashed; check Vercel function logs.`,
      },
      { status: 502 },
    );
  }

  // --- 4. Parse the JSON --------------------------------------------
  // Reusing the same forgiveness pattern as agent-runtime: try direct
  // parse, strip markdown fences, find the first balanced { }.
  let wizardJson: unknown;
  try {
    wizardJson = JSON.parse(resultText);
  } catch {
    const cleaned = extractJsonObject(resultText);
    if (cleaned) {
      try {
        wizardJson = JSON.parse(cleaned);
      } catch {
        // fall through
      }
    }
  }

  if (!wizardJson || typeof wizardJson !== 'object') {
    const preview = resultText.slice(0, 300);
    return Response.json(
      { error: `Wizard JSON was not parseable. First 300 chars: ${preview}` },
      { status: 502 },
    );
  }

  // Light shape validation. We don't need full JSON-schema validation
  // here — the client is forgiving (will skip malformed questions).
  const wizard = wizardJson as { title?: string; questions?: unknown };
  if (!Array.isArray(wizard.questions) || wizard.questions.length === 0) {
    return Response.json(
      { error: 'Wizard had no questions in it' },
      { status: 502 },
    );
  }

  console.log(
    `[build-wizard:${slug}] built ${wizard.questions.length} questions in ${Date.now() - t0}ms`,
  );

  return Response.json({ wizard: wizardJson });
}

/**
 * Strip markdown fences and pull out the first balanced { ... }.
 * Same logic as parseFinalOutput in agent-runtime — kept local here
 * to avoid coupling this route to the runtime module.
 */
function extractJsonObject(raw: string): string | null {
  let s = raw.trim();
  const fenceMatch = s.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) s = fenceMatch[1].trim();

  // Scan for the first balanced { ... }, respecting string literals.
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '{') continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (esc) {
        esc = false;
        continue;
      }
      if (inStr) {
        if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') {
        inStr = true;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) return s.slice(i, j + 1);
      }
    }
  }
  return null;
}

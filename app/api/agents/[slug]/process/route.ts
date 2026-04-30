/**
 * POST /api/agents/[slug]/process
 *
 * Accepts: multipart/form-data with per-slot file fields + optional `context`.
 * Returns: JSON `{ sessionId, teaser, remaining, gated, toolTrace, workflowTrace }`
 *          (the full result lives in Redis; /unlock retrieves it.)
 *
 * Three execution paths based on agent config — picked in this order:
 *
 *   A) Workflow (agent.workflow defined) — Level 3. The runner iterates
 *      declared steps, threading state, surfacing per-step status +
 *      summary + duration to the UI. Tool calls are made inside steps
 *      directly (no autonomous LLM tool loop).
 *
 *   B) Tool-using (agent.tools defined, no workflow) — Level 2. Two
 *      phases: `generateText` with tools + maxSteps for research, then
 *      `generateObject` to structure. Used by simpler agents that don't
 *      need explicit step orchestration.
 *
 *   C) Single-shot (no tools, no workflow) — Level 1. One generateObject
 *      call.
 *
 * No agent currently uses path (B) — both have been promoted to (A) — but
 * we keep it so a partial-migration agent can drop into the marketplace
 * without breakage.
 *
 * Why non-streaming:
 *   We originally used `streamObject` with NDJSON. On certain Windows
 *   setups (security tools intercepting SSE) undici's fetch hangs waiting
 *   for the first token even though non-streaming calls work fine.
 *   `generateObject` does one request/response round-trip, dodging SSE.
 */
import { generateObject, generateText } from 'ai';
import { randomUUID } from 'crypto';
import { getAgent } from '@/lib/agents/registry';
import type {
  ParsedInput,
  ToolCallRecord,
  WorkflowDefinition,
  WorkflowStepRecord,
} from '@/lib/agents/types';
import { getModel } from '@/lib/llm';
import { parseFile } from '@/lib/parse-file';
import { redis, sessionKey, SESSION_TTL_SECONDS } from '@/lib/redis';
import { runWorkflow } from '@/lib/workflow-runner';

export const runtime = 'nodejs';
// Workflow agents make 2-4 model calls + tool fan-outs. 120s fits under
// Vercel Pro's 300s cap with clear ceiling for the client.
export const maxDuration = 120;

const AGENT_TIMEOUT_MS = 100_000;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const agent = getAgent(slug);
  const t0 = Date.now();
  console.log(`[${slug}] POST received at ${new Date(t0).toISOString()}`);

  if (!agent) {
    return Response.json({ error: 'Agent not found' }, { status: 404 });
  }

  // Sanity-check agent config: must have one of buildPrompt or workflow.
  // If neither is set, the agent is broken — fail loudly here rather than
  // discovering it deep inside one of the execution paths.
  if (!agent.workflow && !agent.buildPrompt) {
    return Response.json(
      { error: 'Agent has neither a workflow nor a buildPrompt; refusing to run.' },
      { status: 500 },
    );
  }

  // --- 1. Parse multipart body -------------------------------------------
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    return Response.json(
      { error: 'Invalid multipart body', detail: String(error) },
      { status: 400 },
    );
  }

  const filesBySlot: Record<string, File[]> = {};
  for (const slot of agent.fileSlots) {
    const raw = formData.getAll(slot.key).filter((v): v is File => v instanceof File);
    filesBySlot[slot.key] = raw;

    const required = slot.required !== false;
    if (required && raw.length === 0) {
      return Response.json(
        { error: `${slot.label}: at least one file required` },
        { status: 400 },
      );
    }
    if (raw.length > slot.maxFiles) {
      return Response.json(
        { error: `${slot.label}: too many files (max ${slot.maxFiles})` },
        { status: 400 },
      );
    }

    const maxBytes = slot.maxSizeMB * 1024 * 1024;
    for (const file of raw) {
      if (file.size > maxBytes) {
        return Response.json(
          { error: `${slot.label}: ${file.name} exceeds ${slot.maxSizeMB}MB` },
          { status: 400 },
        );
      }
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (!slot.extensions.includes(ext)) {
        return Response.json(
          {
            error: `${slot.label}: ${file.name} has unsupported extension. Accepted: ${slot.extensions.join(', ')}`,
          },
          { status: 400 },
        );
      }
    }
  }

  const totalFiles = Object.values(filesBySlot).reduce((n, arr) => n + arr.length, 0);
  if (totalFiles === 0) {
    return Response.json({ error: 'No files uploaded' }, { status: 400 });
  }

  // --- 2. Parse files to text (per slot, in parallel) --------------------
  let parsedBySlot: Record<string, ParsedInput[]>;
  try {
    const entries = await Promise.all(
      Object.entries(filesBySlot).map(async ([key, arr]) => {
        const parsed = await Promise.all(arr.map(parseFile));
        return [key, parsed] as const;
      }),
    );
    parsedBySlot = Object.fromEntries(entries);
  } catch (error) {
    return Response.json(
      { error: 'Failed to parse file', detail: String(error) },
      { status: 400 },
    );
  }

  // --- 3. Read visitor-supplied context ----------------------------------
  const contextRaw = formData.get('context');
  const context = typeof contextRaw === 'string' ? contextRaw : '';
  if (agent.contextInput?.required && !context.trim()) {
    return Response.json(
      { error: `${agent.contextInput.label} is required` },
      { status: 400 },
    );
  }

  // --- 4. Run the agent --------------------------------------------------
  const sessionId = randomUUID();
  const key = process.env.ANTHROPIC_API_KEY ?? '';
  const mode = agent.workflow
    ? 'workflow'
    : agent.tools && Object.keys(agent.tools).length > 0
      ? 'agentic'
      : 'single-shot';

  console.log(
    `[${slug}] mode=${mode} ` +
      (agent.workflow
        ? `steps=${agent.workflow.steps.length} `
        : `tools=${Object.keys(agent.tools ?? {}).join(',') || 'none'} `) +
      `model=${agent.llm.model} ` +
      `parse=${Date.now() - t0}ms ` +
      `key=${key ? key.slice(0, 7) + '…' + key.slice(-4) + ' len=' + key.length : 'MISSING'}`,
  );

  const abortController = new AbortController();
  const abortTimer = setTimeout(() => {
    console.error(`[${slug}] LLM call exceeded ${AGENT_TIMEOUT_MS}ms — aborting`);
    abortController.abort();
  }, AGENT_TIMEOUT_MS);

  let object: unknown;
  let toolTrace: ToolCallRecord[] = [];
  let workflowTrace: WorkflowStepRecord[] = [];
  let totalTokens = 0;

  try {
    if (agent.workflow) {
      // -------- (A) Workflow path -----------------------------------
      const model = getModel(agent.llm.model);
      const result = await runWorkflow(
        agent.workflow as WorkflowDefinition<unknown, unknown>,
        { files: parsedBySlot, context },
        {
          model,
          tools: agent.tools ?? {},
          abortSignal: abortController.signal,
        },
      );
      object = result.output;
      toolTrace = result.toolTrace;
      workflowTrace = result.trace;
      totalTokens = result.totalTokens;

      console.log(
        `[${slug}] workflow done: ` +
          `${workflowTrace.filter((s) => s.status === 'completed').length}/${workflowTrace.length} step(s) completed, ` +
          `${workflowTrace.filter((s) => s.status === 'skipped').length} skipped, ` +
          `${toolTrace.length} tool call(s), tokens=${totalTokens}`,
      );
    } else {
      // For non-workflow agents we still need the buildPrompt result.
      // The earlier sanity check guarantees buildPrompt is present here.
      const { system, user } = agent.buildPrompt!({
        files: parsedBySlot,
        context,
      });
      const hasTools = agent.tools && Object.keys(agent.tools).length > 0;

      if (hasTools) {
        // -------- (B) Tool-using (Level 2) -------------------------
        const research = await generateText({
          model: getModel(agent.llm.model),
          system,
          prompt: user,
          tools: agent.tools,
          maxSteps: agent.llm.maxSteps ?? 5,
          temperature: agent.llm.temperature,
          abortSignal: abortController.signal,
        });
        toolTrace = extractToolTrace(research.steps);
        totalTokens += research.usage?.totalTokens ?? 0;

        const structured = await generateObject({
          model: getModel(agent.llm.model),
          schema: agent.schema,
          system: 'Convert the research below into the required schema. Preserve every fact the research established. Never invent data.',
          prompt: `ORIGINAL TASK:\n${user}\n\nRESEARCH:\n${research.text}\n\nTOOL CALLS:\n${formatToolTraceForPrompt(toolTrace)}`,
          temperature: 0,
          maxTokens: agent.llm.maxOutputTokens,
          abortSignal: abortController.signal,
        });
        object = structured.object;
        totalTokens += structured.usage?.totalTokens ?? 0;
      } else {
        // -------- (C) Single-shot ----------------------------------
        const completion = await generateObject({
          model: getModel(agent.llm.model),
          schema: agent.schema,
          system,
          prompt: user,
          temperature: agent.llm.temperature,
          maxTokens: agent.llm.maxOutputTokens,
          abortSignal: abortController.signal,
        });
        object = completion.object;
        totalTokens += completion.usage?.totalTokens ?? 0;
      }
    }
  } catch (error) {
    clearTimeout(abortTimer);
    console.error(`[${slug}] agent run failed after ${Date.now() - t0}ms:`, error);
    const aborted = abortController.signal.aborted;
    return Response.json(
      {
        error: aborted
          ? `Model call timed out after ${Math.round(AGENT_TIMEOUT_MS / 1000)}s with no response. ` +
            `Common causes: ANTHROPIC_API_KEY is unset/invalid, or api.anthropic.com is unreachable ` +
            `(VPN, firewall, corporate antivirus intercepting HTTPS).`
          : error instanceof Error
            ? error.message
            : String(error),
        // Surface partial workflow trace on failure so the client can
        // show "step 3 failed: ..." instead of a blank error card.
        workflowTrace,
        toolTrace,
      },
      { status: aborted ? 504 : 502 },
    );
  }
  clearTimeout(abortTimer);

  console.log(
    `[${slug}] completed after ${Date.now() - t0}ms · ` +
      `tools=${toolTrace.length} · tokens=${totalTokens} · session=${sessionId}`,
  );

  // --- 5. Split into teaser vs full, persist to Redis --------------------
  const { teaser, remaining, gated } = agent.teaser(object as never);

  try {
    await redis.set(
      sessionKey(sessionId),
      JSON.stringify({
        slug,
        full: object,
        teaser,
        remaining,
        gated,
        toolTrace,
        workflowTrace,
      }),
      { ex: SESSION_TTL_SECONDS },
    );
  } catch (redisError) {
    console.error(`[${slug}] redis write failed:`, redisError);
  }

  return Response.json(
    { sessionId, teaser, remaining, gated, toolTrace, workflowTrace },
    { headers: { 'X-Session-Id': sessionId } },
  );
}

// ---------------------------------------------------------------------------
// Tool-trace helpers (used by Level-2 path only — workflow path produces
// its own trace via the runner)
// ---------------------------------------------------------------------------

type AnyStep = {
  toolCalls?: Array<{ toolCallId?: string; toolName?: string; args?: unknown }>;
  toolResults?: Array<{ toolCallId?: string; result?: unknown }>;
};

function extractToolTrace(steps: readonly unknown[]): ToolCallRecord[] {
  const out: ToolCallRecord[] = [];
  for (const rawStep of steps) {
    const step = rawStep as AnyStep;
    const calls = step.toolCalls ?? [];
    const results = step.toolResults ?? [];
    const resultById = new Map<string, unknown>();
    for (const r of results) {
      if (r.toolCallId) resultById.set(r.toolCallId, r.result);
    }

    for (const call of calls) {
      const result = call.toolCallId ? resultById.get(call.toolCallId) : undefined;
      const failed = isToolError(result);
      out.push({
        tool: call.toolName ?? 'unknown',
        args: (call.args as Record<string, unknown>) ?? {},
        summary: summarizeResult(call.toolName ?? '', result),
        failed,
        durationMs:
          typeof (result as { elapsedMs?: unknown })?.elapsedMs === 'number'
            ? (result as { elapsedMs: number }).elapsedMs
            : 0,
      });
    }
  }
  return out;
}

function isToolError(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  return 'error' in result && Boolean((result as { error?: unknown }).error);
}

function summarizeResult(toolName: string, result: unknown): string {
  if (!result || typeof result !== 'object') return '(no result)';
  const r = result as Record<string, unknown>;
  if (typeof r.error === 'string') return `error: ${r.error}`;

  switch (toolName) {
    case 'searchWeb': {
      if (r.empty) return 'no DDG abstract';
      const heading = typeof r.heading === 'string' ? r.heading : '';
      const source = typeof r.abstractSource === 'string' ? r.abstractSource : '';
      const topics = Array.isArray(r.topics) ? r.topics.length : 0;
      return [heading, source && `via ${source}`, topics && `${topics} topics`]
        .filter(Boolean)
        .join(' · ') || 'ok';
    }
    case 'convertCurrency': {
      if (r.noop) return `${r.amount} ${r.from} (same currency)`;
      if (typeof r.converted === 'number') {
        return `${r.amount} ${r.from} → ${r.converted} ${r.to} @ ${r.rate}`;
      }
      return 'ok';
    }
    case 'fetchWebpage': {
      const title = typeof r.title === 'string' ? r.title : '';
      const bytes = typeof r.bytes === 'number' ? `${Math.round(r.bytes / 1024)}KB` : '';
      return [title, bytes].filter(Boolean).join(' · ') || 'ok';
    }
    default: {
      for (const [k, v] of Object.entries(r)) {
        if (typeof v === 'string' && v.length > 0 && v.length < 200) return `${k}: ${v}`;
      }
      return 'ok';
    }
  }
}

function formatToolTraceForPrompt(trace: ToolCallRecord[]): string {
  if (trace.length === 0) return '(no tool calls were made)';
  return trace
    .map(
      (t, i) =>
        `${i + 1}. ${t.tool}(${JSON.stringify(t.args)}) → [${t.failed ? 'FAILED' : 'ok'}] ${t.summary}`,
    )
    .join('\n');
}

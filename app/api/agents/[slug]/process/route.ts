/**
 * POST /api/agents/[slug]/process
 *
 * Accepts: multipart/form-data with per-slot file fields + optional `context`.
 * Returns: JSON { sessionId, teaser, remaining, gated, toolTrace, turnTrace }.
 *
 * Now powered by the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`).
 * The route is mostly plumbing — validate inputs, parse files, call
 * `runAgent(config, input)`, persist + return. The SDK runs the
 * agent loop (tool use, structured output) internally.
 */
import { randomUUID } from 'crypto';
import { runAgent } from '@/lib/agent-runtime';
import { getAgent } from '@/lib/agents/registry';
import type { ParsedInput } from '@/lib/agents/types';
import { parseFile } from '@/lib/parse-file';
import { redis, sessionKey, SESSION_TTL_SECONDS } from '@/lib/redis';

// Node runtime — the Agent SDK uses Node-only APIs (subprocess, dns).
export const runtime = 'nodejs';

// 800s is the upper bound for Vercel Functions on the Pro plan
// (Fluid Compute). Discovery agents like the GCC Prospector can
// legitimately run 5-10 min when verifying 10+ prospects, each of
// which costs 4-6 tool calls + a verification round-trip. Lead
// Qualifier / Invoice Auditor still finish well inside this — they
// rarely exceed 90s.
export const maxDuration = 800;

// Server-side abort fires slightly under the platform cap so we
// return a clean 504 with our own error envelope instead of letting
// Vercel kill the function and serve its generic 504 page.
const AGENT_TIMEOUT_MS = 780_000;

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

  // --- 1. Parse multipart body --------------------------------------
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    return Response.json(
      { error: 'Invalid multipart body', detail: String(error) },
      { status: 400 },
    );
  }

  // Per-slot file validation (count, size, extension).
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

  // For agents that declare file slots, require at least one file
  // across them. Agents that declare ZERO file slots (e.g., the GCC
  // Prospector — pure discovery from a wizard-driven ICP) skip this
  // check entirely.
  if (agent.fileSlots.length > 0) {
    const totalFiles = Object.values(filesBySlot).reduce((n, arr) => n + arr.length, 0);
    if (totalFiles === 0) {
      return Response.json({ error: 'No files uploaded' }, { status: 400 });
    }
  }

  // --- 2. Parse files to text (per slot, in parallel) ---------------
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

  // --- 3. Read visitor-supplied context -----------------------------
  const contextRaw = formData.get('context');
  const context = typeof contextRaw === 'string' ? contextRaw : '';
  if (agent.contextInput?.required && !context.trim()) {
    return Response.json(
      { error: `${agent.contextInput.label} is required` },
      { status: 400 },
    );
  }

  // --- 4. Run the agent via the SDK ---------------------------------
  const sessionId = randomUUID();
  const key = process.env.ANTHROPIC_API_KEY ?? '';
  console.log(
    `[${slug}] starting agent run ` +
      `model=${agent.llm.model} maxTurns=${agent.llm.maxTurns} ` +
      `parse=${Date.now() - t0}ms ` +
      `key=${key ? key.slice(0, 7) + '…' + key.slice(-4) + ' len=' + key.length : 'MISSING'}`,
  );

  const abortController = new AbortController();
  const abortTimer = setTimeout(() => {
    console.error(`[${slug}] agent run exceeded ${AGENT_TIMEOUT_MS}ms — aborting`);
    abortController.abort();
  }, AGENT_TIMEOUT_MS);

  let output: unknown;
  let toolTrace: unknown;
  let turnTrace: unknown;
  let totalTokens = 0;

  try {
    const result = await runAgent(agent, { files: parsedBySlot, context }, {
      abortSignal: abortController.signal,
    });
    output = result.output;
    toolTrace = result.toolTrace;
    turnTrace = result.turnTrace;
    totalTokens = result.totalTokens;
  } catch (error) {
    clearTimeout(abortTimer);
    console.error(`[${slug}] agent run failed after ${Date.now() - t0}ms:`, error);
    const aborted = abortController.signal.aborted;
    return Response.json(
      {
        error: aborted
          ? `Agent run timed out after ${Math.round(AGENT_TIMEOUT_MS / 1000)}s with no result. ` +
            `Common causes: ANTHROPIC_API_KEY missing/invalid, network reaching api.anthropic.com is blocked, ` +
            `or maxTurns hit before the model finalized output.`
          : error instanceof Error
            ? error.message
            : String(error),
      },
      { status: aborted ? 504 : 502 },
    );
  }
  clearTimeout(abortTimer);

  console.log(
    `[${slug}] completed after ${Date.now() - t0}ms · ` +
      `tokens=${totalTokens} · session=${sessionId}`,
  );

  // --- 5. Split into teaser vs full, persist to Redis ----------------
  const { teaser, remaining, gated } = agent.teaser(output as never);

  try {
    await redis.set(
      sessionKey(sessionId),
      JSON.stringify({ slug, full: output, teaser, remaining, gated, toolTrace, turnTrace }),
      { ex: SESSION_TTL_SECONDS },
    );
  } catch (redisError) {
    console.error(`[${slug}] redis write failed:`, redisError);
  }

  return Response.json(
    { sessionId, teaser, remaining, gated, toolTrace, turnTrace },
    { headers: { 'X-Session-Id': sessionId } },
  );
}

/**
 * Agent runtime — runs an `AgentConfig` via the Claude Agent SDK and
 * returns the structured output + traces that the UI renders.
 *
 * Why this layer exists:
 *   The Agent SDK's `query()` gives us an async-iterable message stream.
 *   We need to:
 *     1. drive the agent loop until completion (or abort),
 *     2. extract the final structured output,
 *     3. capture every tool call so the UI can show "agent did X, then Y",
 *     4. record per-turn timing/narration so we can render a timeline.
 *
 *   That bookkeeping is generic across agents — putting it in one place
 *   means adding a new agent is just declaring a config, not wiring up
 *   another loop.
 *
 * Notes on the SDK:
 *   - Tool calls live inside `assistant` messages as `tool_use` blocks.
 *     Tool results come back as `tool_result` blocks in subsequent
 *     `user` messages. We pair them by `tool_use_id` for the trace.
 *   - The final structured output arrives via a `result` message whose
 *     `result` field is the JSON the model committed to (per the
 *     `outputFormat: { type: 'json_schema' }` option).
 *   - SDK message shapes vary across versions; we read fields
 *     defensively (`unknown` + narrow) so a minor SDK bump doesn't
 *     silently break parsing.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { existsSync, chmodSync } from 'fs';
import { join } from 'path';
import type {
  AgentConfig,
  AgentTurnRecord,
  ParsedInput,
  ToolCallRecord,
} from './agents/types';

/**
 * Resolve the per-platform Claude binary path explicitly. Vercel's
 * function bundle puts node_modules at a known location but the SDK's
 * automatic binary discovery sometimes fails in serverless because
 * it relies on `require.resolve` against a globally-installed CLI,
 * not the per-platform optional dep we bundled.
 *
 * Returns undefined on platforms we don't have a binary for; in that
 * case we let the SDK try its default lookup (works on dev machines).
 */
function resolveClaudeBinary(): string | undefined {
  const platform = process.platform; // 'linux' | 'darwin' | 'win32'
  const arch = process.arch; // 'x64' | 'arm64' | ...
  const pkgName = `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`;
  const binaryName = platform === 'win32' ? 'claude.exe' : 'claude';

  // Try a few candidate roots — Next.js standalone vs. dev vs. bundled
  // function output put node_modules in slightly different places.
  const candidates = [
    join(process.cwd(), 'node_modules', pkgName, binaryName),
    join(process.cwd(), '.next', 'standalone', 'node_modules', pkgName, binaryName),
    join('/var/task', 'node_modules', pkgName, binaryName),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      // Vercel's function bundling sometimes drops the +x bit. Re-set
      // it before the SDK tries to spawn — cheap and idempotent.
      try {
        chmodSync(path, 0o755);
      } catch {
        /* ignore — chmod fails on read-only mounts but the perm may
         * already be correct from the install step */
      }
      return path;
    }
  }
  return undefined;
}

/**
 * Vercel functions only have ONE writable path: /tmp. The Claude CLI
 * subprocess writes session files, caches, and config there. Without
 * pointing HOME at a writable dir, the subprocess silently dies during
 * setup (no messages, no errors — just an empty stream).
 */
const SERVERLESS_HOME = '/tmp';

export interface AgentRunResult<TOutput> {
  /** Structured output, validated by the SDK against the agent's JSON Schema. */
  output: TOutput;
  /** Flat list of every tool call across the run, in chronological order. */
  toolTrace: ToolCallRecord[];
  /** Per-turn timeline entries (one per assistant turn). */
  turnTrace: AgentTurnRecord[];
  /** Sum of input + output tokens reported by the SDK. */
  totalTokens: number;
}

export interface AgentRunInput {
  files: Record<string, ParsedInput[]>;
  context: string;
}

export async function runAgent<TOutput>(
  config: AgentConfig<TOutput>,
  input: AgentRunInput,
  options: { abortSignal?: AbortSignal } = {},
): Promise<AgentRunResult<TOutput>> {
  const userPrompt = config.buildUserPrompt(input);

  const toolTrace: ToolCallRecord[] = [];
  const turnTrace: AgentTurnRecord[] = [];
  let totalTokens = 0;
  let finalOutput: TOutput | undefined;
  // Diagnostic: track every message type we see so on-stream-end we can
  // log a histogram. If we ended without a `result` message, the histogram
  // tells us whether we got system errors / API retries / nothing at all.
  const messageHistogram = new Map<string, number>();
  /** Capture API retries / system errors verbatim — these are the most
   *  common reason the stream dies early on serverless. */
  const systemEvents: string[] = [];
  const tag = `[runtime:${config.slug}]`;
  const binaryPath = resolveClaudeBinary();
  console.log(
    `${tag} starting query: model=${config.llm.model} maxTurns=${config.llm.maxTurns} ` +
      `platform=${process.platform}-${process.arch} ` +
      `binary=${binaryPath ?? 'AUTO-DISCOVERY'}`,
  );

  // Turn-tracking state. We open a new turn record on each `assistant`
  // message and close it when we see the next `user` message (which
  // carries the prior turn's tool results). Last turn is closed at the
  // end-of-stream.
  let currentTurn: AgentTurnRecord | null = null;
  let currentTurnStartedAt = 0;
  // Maps tool_use_id → record we already pushed, so we can stamp the
  // result summary onto it when the matching tool_result arrives.
  const pendingByToolUseId = new Map<string, ToolCallRecord>();

  // Compose the final system prompt: agent's own prompt + a strict
  // "respond with only JSON matching this schema" footer. Putting the
  // schema in the prompt is what actually convinces Claude to constrain
  // output — outputFormat option alone wasn't enough in SDK 0.2.x.
  const systemPromptWithSchema = `${config.systemPrompt}

---

FINAL RESPONSE FORMAT — STRICT

Your final response (after all tool calls are done) must be a single JSON object matching the schema below. No markdown. No fenced code blocks. No commentary before or after. The first character must be \`{\` and the last must be \`}\`.

Schema:
${JSON.stringify(config.outputSchema, null, 2)}`;

  for await (const message of query({
    prompt: userPrompt,
    options: {
      model: config.llm.model,
      systemPrompt: systemPromptWithSchema,
      maxTurns: config.llm.maxTurns,
      mcpServers: { agent: config.mcpServer },
      allowedTools: config.allowedTools,
      // Server-side automation — no human is at a terminal to grant
      // tool permissions. 'bypassPermissions' tells the SDK to skip
      // the interactive permission prompt entirely. The `allowedTools`
      // whitelist above is the actual safety boundary; the SDK will
      // still refuse to call any tool not in that list.
      permissionMode: 'bypassPermissions',
      // NOTE: We used to pass `outputFormat: { type: 'json_schema', schema }`
      // here, but the SDK 0.2.x version doesn't reliably enforce schema —
      // Claude often returned markdown reports anyway. Instead we put the
      // schema *in* the system prompt with explicit "JSON only" rules
      // (see config.systemPrompt) and let our parser handle whatever
      // wrapping shows up. More reliable in practice, less magic.
      // SERVERLESS HARDENING — these three are why a regular
      // hello-world `query()` returns zero messages on Vercel:
      //   • cwd → must be writable; only /tmp is on Vercel functions
      //   • env.HOME → SDK writes session files / configs to $HOME
      //   • pathToClaudeCodeExecutable → forces the bundled binary
      //     instead of relying on $PATH or auto-discovery
      cwd: SERVERLESS_HOME,
      env: { ...process.env, HOME: SERVERLESS_HOME },
      ...(binaryPath ? { pathToClaudeCodeExecutable: binaryPath } : {}),
      abortSignal: options.abortSignal,
    },
  } as never)) {
    const msg = message as MessageLike & { subtype?: string };
    // Diagnostic: count + log the kind of message we just received.
    const tag2 = `${msg.type}${msg.subtype ? `:${msg.subtype}` : ''}`;
    messageHistogram.set(tag2, (messageHistogram.get(tag2) ?? 0) + 1);
    if (msg.type === 'system') {
      // System messages carry retries, status changes, errors. Capture
      // any text we can see so the post-mortem log shows what happened.
      const sys = message as Record<string, unknown>;
      const detail = JSON.stringify(sys).slice(0, 400);
      systemEvents.push(detail);
      console.log(`${tag} system msg: ${detail}`);
    }

    // ---- Assistant turn boundary ---------------------------------
    if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
      // Close the previous turn (if any) before opening a new one.
      if (currentTurn) closeTurn(currentTurn, currentTurnStartedAt, turnTrace);
      currentTurn = { turn: turnTrace.length + 1, status: 'completed', durationMs: 0 };
      currentTurnStartedAt = Date.now();

      const narrationParts: string[] = [];
      for (const block of msg.message!.content!) {
        const b = block as ContentBlockLike;
        if (b.type === 'text' && typeof b.text === 'string') {
          narrationParts.push(b.text);
        } else if (b.type === 'tool_use' && typeof b.id === 'string') {
          const record: ToolCallRecord = {
            tool: stripMcpPrefix(typeof b.name === 'string' ? b.name : 'unknown'),
            args: (b.input as Record<string, unknown>) ?? {},
            summary: '(awaiting result)',
            failed: false,
            durationMs: 0,
          };
          toolTrace.push(record);
          pendingByToolUseId.set(b.id, record);
          (currentTurn.toolCalls ??= []).push(record);
        }
      }
      if (narrationParts.length > 0) {
        currentTurn.narration = narrationParts.join('\n').slice(0, 600);
      }
      // Token usage, when reported on the assistant message.
      const usage = (msg.message as { usage?: { input_tokens?: number; output_tokens?: number } } | undefined)?.usage;
      if (usage) {
        const turnTokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
        currentTurn.modelTokens = turnTokens;
        totalTokens += turnTokens;
      }
    }

    // ---- Tool results (carried by user messages) -----------------
    if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
      for (const block of msg.message!.content!) {
        const b = block as ContentBlockLike;
        if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
          const record = pendingByToolUseId.get(b.tool_use_id);
          if (!record) continue;
          const { summary, failed } = interpretToolResult(record.tool, b.content);
          record.summary = summary;
          record.failed = failed;
          pendingByToolUseId.delete(b.tool_use_id);
        }
      }
    }

    // ---- Final result --------------------------------------------
    // The SDK emits SDKResultMessage with subtype:
    //   'success' → carries the structured `result` string
    //   'error_max_turns' → loop hit the cap before finalizing
    //   'error_max_structured_output_retries' → schema validation kept failing
    //   'error_max_budget_usd' / 'error_during_execution' → other failures
    // We surface the specific error subtype so the chat shows actionable text.
    if (msg.type === 'result') {
      if (currentTurn) {
        closeTurn(currentTurn, currentTurnStartedAt, turnTrace);
        currentTurn = null;
      }
      const r = msg as {
        subtype?: string;
        result?: unknown;
        is_error?: boolean;
        num_turns?: number;
        stop_reason?: string | null;
      };
      if (r.subtype === 'success' && r.result !== undefined) {
        // Log the first 200 chars so if parsing fails we can see what
        // shape Claude actually emitted (markdown, prefix, JSON, etc.).
        const preview = typeof r.result === 'string'
          ? r.result.length > 200 ? r.result.slice(0, 200) + '…' : r.result
          : '(non-string result)';
        console.log(`${tag} result.success preview: ${preview}`);
        finalOutput = parseFinalOutput<TOutput>(r.result);
      } else {
        const reasons: Record<string, string> = {
          error_max_turns: `Agent hit the turn limit (${r.num_turns ?? '?'} turns) before producing a final result. Increase llm.maxTurns or simplify the system prompt.`,
          error_max_structured_output_retries:
            "Claude's output kept failing schema validation across retries. Schema may be too strict, or the prompt isn't steering toward a clean final JSON.",
          error_max_budget_usd: 'Token-budget cap hit before the agent finished.',
          error_during_execution: `Agent execution failed (stop_reason=${r.stop_reason ?? 'unknown'}).`,
        };
        const subtype = r.subtype ?? 'unknown';
        throw new Error(
          reasons[subtype] ??
            `Agent finished with non-success subtype: ${subtype}. stop_reason=${r.stop_reason ?? 'unknown'}`,
        );
      }
    }
  }

  if (finalOutput === undefined) {
    // Build the most informative possible error: histogram of what we
    // saw, plus the first system event (often the smoking gun — API
    // retry, auth error, etc.).
    const histogram = Array.from(messageHistogram.entries())
      .map(([k, v]) => `${k}×${v}`)
      .join(', ');
    const sysHint =
      systemEvents.length > 0 ? ` First system event: ${systemEvents[0]}` : '';
    console.error(`${tag} stream ended without result. messages=[${histogram}]`);
    throw new Error(
      `Agent stream ended without a result message. Saw: [${histogram}].${sysHint}`,
    );
  }

  console.log(
    `${tag} done: tokens=${totalTokens} turns=${turnTrace.length} tools=${toolTrace.length}`,
  );
  return { output: finalOutput, toolTrace, turnTrace, totalTokens };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MessageLike {
  type: string;
  message?: { content?: unknown[] };
}
interface ContentBlockLike {
  type: string;
  text?: unknown;
  id?: unknown;
  name?: unknown;
  input?: unknown;
  tool_use_id?: unknown;
  content?: unknown;
}

/** "mcp__agent__search_web" → "search_web" — UI shows the bare name. */
function stripMcpPrefix(name: string): string {
  const m = name.match(/^mcp__[^_]+__(.+)$/);
  return m ? m[1] : name;
}

function closeTurn(turn: AgentTurnRecord, startedAt: number, trace: AgentTurnRecord[]) {
  turn.durationMs = Date.now() - startedAt;
  trace.push(turn);
}

/**
 * Convert a tool_result content block into a one-line UI summary.
 *
 * Tool results are an array of content parts (usually a single text
 * part holding our JSON-serialized return value). We parse it back to
 * an object and pick a tool-specific human summary.
 */
function interpretToolResult(toolName: string, content: unknown): { summary: string; failed: boolean } {
  let parsed: Record<string, unknown> | null = null;
  if (Array.isArray(content)) {
    for (const part of content) {
      const p = part as { type?: string; text?: string };
      if (p?.type === 'text' && typeof p.text === 'string') {
        try {
          parsed = JSON.parse(p.text);
        } catch {
          // not JSON — keep raw text as the summary
          return { summary: truncate(p.text, 160), failed: /error/i.test(p.text) };
        }
        break;
      }
    }
  } else if (typeof content === 'string') {
    try {
      parsed = JSON.parse(content);
    } catch {
      return { summary: truncate(content, 160), failed: /error/i.test(content) };
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { summary: '(no parseable result)', failed: false };
  }

  if (typeof parsed.error === 'string') {
    return { summary: `error: ${parsed.error}`, failed: true };
  }

  switch (toolName) {
    case 'search_web': {
      if (parsed.empty) return { summary: 'no DDG abstract', failed: false };
      const heading = typeof parsed.heading === 'string' ? parsed.heading : '';
      const source = typeof parsed.source === 'string' ? parsed.source : '';
      const topics = Array.isArray(parsed.topics) ? parsed.topics.length : 0;
      return {
        summary:
          [heading, source && `via ${source}`, topics && `${topics} topics`]
            .filter(Boolean)
            .join(' · ') || 'ok',
        failed: false,
      };
    }
    case 'convert_currency': {
      if (parsed.noop) return { summary: `${parsed.amount} ${parsed.from} (same currency)`, failed: false };
      if (typeof parsed.converted === 'number') {
        return {
          summary: `${parsed.amount} ${parsed.from} → ${parsed.converted} ${parsed.to} @ ${parsed.rate}`,
          failed: false,
        };
      }
      return { summary: 'ok', failed: false };
    }
    case 'fetch_webpage': {
      const title = typeof parsed.title === 'string' ? parsed.title : '';
      const bytes = typeof parsed.bytes === 'number' ? `${Math.round(parsed.bytes / 1024)}KB` : '';
      return { summary: [title, bytes].filter(Boolean).join(' · ') || 'ok', failed: false };
    }
    default:
      return { summary: 'ok', failed: false };
  }
}

/**
 * Parse the SDK's final-result string into our structured output.
 *
 * In theory `outputFormat: { type: 'json_schema' }` should give us pure
 * JSON. In practice Claude often wraps it in markdown — fenced code
 * blocks (```json ... ```), YAML-style ---fence---, or a preamble like
 * "Here is the output:". We strip all of those before parsing.
 *
 * On failure we log the raw text (truncated) so the next debug round
 * shows what shape Claude actually returned.
 */
function parseFinalOutput<T>(raw: unknown): T {
  if (raw == null) {
    throw new Error('Final result message had no `result` field');
  }
  if (typeof raw !== 'string') {
    return raw as T;
  }

  // Try the cheapest path first.
  const direct = tryParse<T>(raw);
  if (direct.ok) return direct.value;

  // Strip wrappers and try again.
  const cleaned = extractJsonPayload(raw);
  if (cleaned !== raw) {
    const cleanedTry = tryParse<T>(cleaned);
    if (cleanedTry.ok) return cleanedTry.value;
  }

  // Last resort: scan for the first { or [ and the matching close,
  // then parse the substring. Handles preambles like "Here is the
  // output:\n{...}" without false matches inside string values.
  const sliced = sliceFirstJsonContainer(cleaned);
  if (sliced) {
    const slicedTry = tryParse<T>(sliced);
    if (slicedTry.ok) return slicedTry.value;
  }

  // All fallbacks failed — surface what we saw so the user can debug.
  const preview = raw.length > 400 ? raw.slice(0, 400) + '…' : raw;
  console.error('[runtime] could not parse final result. Raw:', preview);
  throw new Error(
    `Final result was not parseable JSON. First 200 chars: ${preview.slice(0, 200)}`,
  );
}

function tryParse<T>(s: string): { ok: true; value: T } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(s) as T };
  } catch {
    return { ok: false };
  }
}

/** Strip common markdown / fence wrappers around a JSON payload. */
function extractJsonPayload(raw: string): string {
  let s = raw.trim();
  // ```json ... ``` or ``` ... ```
  const fenceMatch = s.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) {
    s = fenceMatch[1].trim();
  }
  // YAML-style --- delimiters around the payload.
  if (s.startsWith('---')) {
    const inner = s.replace(/^---+\s*/, '').replace(/\s*---+\s*$/, '');
    s = inner.trim();
  }
  return s;
}

/**
 * Find the first balanced { … } or [ … ] in a string and return that
 * substring. Naive but good enough for cleaning up Claude preambles.
 * Respects string literals so we don't trip on { or } inside them.
 */
function sliceFirstJsonContainer(s: string): string | null {
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== '{' && ch !== '[') continue;
    const open = ch;
    const close = ch === '{' ? '}' : ']';
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
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) return s.slice(i, j + 1);
      }
    }
  }
  return null;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
